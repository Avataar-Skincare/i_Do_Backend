import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { RazorpayService } from '../../payments/razorpay.service';
import { SettingsService } from '../../settings/settings.service';
import { OrderStateService } from '../state/order-state.service';
import { PaymentCaptureService } from './payment-capture.service';
import type { PaymentGateway } from './payment-gateway';
import { RazorpayWebhookService } from './razorpay-webhook.service';

/** pg advisory lock id: one sweeper at a time across backend instances (TD-10). */
export const SWEEP_LOCK_KEY = 7_300_001;
const BATCH = 200;

export type SweepResult =
  | { locked: true }
  | {
      confirmed: number;
      expired: number;
      skipped: number;
      eventsRetried: number;
    };

/**
 * payment_sweep (LLD §3.1 transition 3, TD-9, TD-10).
 *
 * Online orders still pending_payment after `pending_payment_ttl_hours`:
 * Razorpay is asked first — captured → confirm (the webhook was missed);
 * authorized → leave for the next run (auto-capture is in flight); nothing →
 * cancel as unpaid. If Razorpay can't be reached the order is skipped —
 * never cancelled blind. A capture that lands after the cancel becomes a
 * late_capture refund (PaymentCaptureService).
 *
 * Also retries stored webhook events that failed to apply (transient errors).
 */
@Injectable()
export class PaymentSweepService {
  private readonly logger = new Logger(PaymentSweepService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly capture: PaymentCaptureService,
    private readonly orderState: OrderStateService,
    private readonly webhook: RazorpayWebhookService,
    @Inject(RazorpayService) private readonly gateway: PaymentGateway,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'payment_sweep' })
  async scheduled(): Promise<void> {
    try {
      const r = await this.run();
      if (
        !('locked' in r) &&
        r.confirmed + r.expired + r.skipped + r.eventsRetried > 0
      ) {
        this.logger.log(`payment_sweep: ${JSON.stringify(r)}`);
      }
    } catch (e) {
      this.logger.error(`payment_sweep failed: ${(e as Error).message}`);
    }
  }

  async run(): Promise<SweepResult> {
    // Session-level lock on a dedicated connection: the sweep makes network
    // calls, so it must not hold one transaction open for its whole run.
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    try {
      const [{ ok }] = await qr.query('SELECT pg_try_advisory_lock($1) AS ok', [
        SWEEP_LOCK_KEY,
      ]);
      if (!ok) return { locked: true };
      try {
        return {
          ...(await this.expireDue()),
          eventsRetried: await this.retryEvents(),
        };
      } finally {
        await qr.query('SELECT pg_advisory_unlock($1)', [SWEEP_LOCK_KEY]);
      }
    } finally {
      await qr.release();
    }
  }

  private async expireDue() {
    const { pending_payment_ttl_hours: ttl } = await this.settings.getMany<{
      pending_payment_ttl_hours: number;
    }>(['pending_payment_ttl_hours']);
    const due: Array<{ id: string; rzp_order_ids: string[] }> =
      await this.dataSource.query(
        `SELECT o."id", array_remove(array_agg(p."razorpay_order_id"), NULL) AS rzp_order_ids
       FROM "orders" o
       LEFT JOIN "payments" p ON p."order_id" = o."id" AND p."method" = 'razorpay'
       WHERE o."status" = 'pending_payment' AND o."payment_method" = 'online'
         AND o."created_at" < now() - make_interval(hours => $1)
       GROUP BY o."id", o."created_at"
       ORDER BY o."created_at"
       LIMIT ${BATCH}`,
        [ttl],
      );

    const counts = { confirmed: 0, expired: 0, skipped: 0 };
    for (const o of due) {
      let payments;
      try {
        payments = (
          await Promise.all(
            o.rzp_order_ids.map((id) => this.gateway.fetchOrderPayments(id)),
          )
        ).flat();
      } catch (e) {
        this.logger.warn(
          `payment_sweep: Razorpay check for ${o.id} failed, will retry: ${(e as Error).message}`,
        );
        counts.skipped++;
        continue;
      }
      const captured = payments.find((p) => p.status === 'captured');
      if (captured) {
        const r = await this.capture.recordCapture(captured, {
          type: 'system',
        });
        if (r.outcome === 'confirmed') counts.confirmed++;
        else counts.skipped++;
        continue;
      }
      if (payments.some((p) => p.status === 'authorized')) {
        counts.skipped++;
        continue;
      }
      const r = await this.orderState.transition(o.id, 'unpaid_expired', {
        type: 'system',
      });
      if (r.applied) counts.expired++;
    }
    return counts;
  }

  /** Capture events stored but not applied (e.g. a DB blip). Mismatch/unknown order are permanent — ops, not retries. */
  private async retryEvents(): Promise<number> {
    const rows: Array<{
      id: string;
      event_type: string;
      payload: Record<string, unknown>;
    }> = await this.dataSource.query(
      `SELECT "id", "event_type", "payload" FROM "payment_events"
       WHERE "processed_at" IS NULL AND "event_type" IN ('payment.captured', 'order.paid')
         AND ("error" IS NULL OR ("error" NOT LIKE 'mismatch%' AND "error" NOT LIKE 'unknown_order%'))
         AND "received_at" > now() - interval '7 days'
       ORDER BY "received_at" LIMIT ${BATCH}`,
    );
    for (const r of rows)
      await this.webhook.process(r.id, r.event_type, r.payload);
    return rows.length;
  }
}
