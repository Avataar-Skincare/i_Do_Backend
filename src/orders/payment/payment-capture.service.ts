import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  OrderStateService,
  type TransitionActor,
} from '../state/order-state.service';
import type { OrderStatus } from '../entities/order.entity';
import type { GatewayPayment } from './payment-gateway';

export type CaptureOutcome =
  /** pending_payment → confirmed (LLD §3.1 transition 2). */
  | 'confirmed'
  /** This capture was already applied (webhook retry, or verify after the webhook). */
  | 'already_recorded'
  /** Money arrived after the order was cancelled: no revive, a full refund instead (TD-9). */
  | 'late_capture_refund'
  /** Amount/currency/payment id doesn't match what we asked for — ops must look. */
  | 'mismatch'
  /** Not a Razorpay order we created. */
  | 'unknown_order'
  /** The order is past payment in a way capture can't change. */
  | 'ignored';

export interface CaptureResult {
  outcome: CaptureOutcome;
  orderId?: string;
  reason?: string;
}

/**
 * The one rule for "Razorpay captured this payment" — used by
 * /payment/verify, the webhook and payment_sweep (TD-8: auto-capture, UNIQUE
 * payment id, guarded update, no revive).
 *
 * The payments row is locked first, so verify and the webhook arriving
 * together run one after the other: the second sees `captured` and is a no-op.
 */
@Injectable()
export class PaymentCaptureService {
  private readonly logger = new Logger(PaymentCaptureService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly orderState: OrderStateService,
  ) {}

  recordCapture(
    p: GatewayPayment,
    actor: TransitionActor,
  ): Promise<CaptureResult> {
    return this.dataSource.transaction(async (m) => {
      const [row]: Array<{
        id: string;
        order_id: string;
        amount: number;
        currency: string;
        status: string;
        razorpay_payment_id: string | null;
      }> = await m.query(
        `SELECT "id", "order_id", "amount", "currency", "status", "razorpay_payment_id"
           FROM "payments" WHERE "razorpay_order_id" = $1 FOR UPDATE`,
        [p.orderId],
      );
      if (!row)
        return {
          outcome: 'unknown_order',
          reason: `no payment for Razorpay order ${p.orderId}`,
        };
      const orderId = row.order_id;

      if (row.status === 'captured') {
        if (row.razorpay_payment_id === p.id)
          return { outcome: 'already_recorded', orderId };
        return this.mismatch(
          orderId,
          `second payment ${p.id} on a Razorpay order already paid by ${row.razorpay_payment_id}`,
        );
      }
      if (p.amount !== row.amount || p.currency !== row.currency) {
        return this.mismatch(
          orderId,
          `paid ${p.amount} ${p.currency}, expected ${row.amount} ${row.currency}`,
        );
      }

      const [o]: Array<{ status: OrderStatus }> = await m.query(
        'SELECT "status" FROM "orders" WHERE "id" = $1 FOR UPDATE',
        [orderId],
      );
      await m.query(
        `UPDATE "payments" SET "status" = 'captured', "razorpay_payment_id" = $2, "captured_at" = now() WHERE "id" = $1`,
        [row.id, p.id],
      );
      const meta = { razorpayPaymentId: p.id, amount: p.amount };

      if (o.status === 'pending_payment') {
        await this.orderState.transition(orderId, 'payment_captured', actor, {
          manager: m,
          meta,
        });
        await m.query(
          'UPDATE "orders" SET "amount_paid" = $2 WHERE "id" = $1',
          [orderId, p.amount],
        );
        return { outcome: 'confirmed', orderId };
      }

      if (o.status === 'cancelled') {
        // TD-9: the 24 h expiry already cancelled it — refund in full, never revive.
        await m.query(
          'UPDATE "orders" SET "amount_paid" = $2 WHERE "id" = $1',
          [orderId, p.amount],
        );
        await m.query(
          `INSERT INTO "refunds" ("order_id", "reason", "amount_paid", "amount", "method", "status")
           VALUES ($1, 'late_capture', $2, $2, 'razorpay', 'requested') ON CONFLICT DO NOTHING`,
          [orderId, p.amount],
        );
        await m.query(
          `INSERT INTO "order_events" ("order_id", "actor_type", "actor_user_id", "event", "meta")
           VALUES ($1, $2, $3, 'late_capture', $4::jsonb)`,
          [orderId, actor.type, actor.userId ?? null, JSON.stringify(meta)],
        );
        this.logger.warn(
          `Late capture ${p.id} on cancelled order ${orderId}: refund requested`,
        );
        return { outcome: 'late_capture_refund', orderId };
      }

      this.logger.error(
        `Capture ${p.id} for order ${orderId} in status ${o.status}: not applied`,
      );
      return { outcome: 'ignored', orderId, reason: `order is ${o.status}` };
    });
  }

  private mismatch(orderId: string, reason: string): CaptureResult {
    this.logger.error(`Payment mismatch on order ${orderId}: ${reason}`);
    return { outcome: 'mismatch', orderId, reason };
  }
}
