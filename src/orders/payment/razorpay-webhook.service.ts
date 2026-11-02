import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { apiError } from '../../common/api-error';
import { PaymentCaptureService } from './payment-capture.service';

interface WebhookBody {
  event: string;
  payload: { payment?: { entity?: Record<string, unknown> } };
}

/** Capture outcomes that mean the event is fully handled. */
const DONE = ['confirmed', 'already_recorded', 'late_capture_refund'];

/**
 * POST /webhooks/razorpay — the source of truth for payments.
 *
 * The HMAC is checked over the raw bytes before anything is stored. A forged
 * event is rejected, not stored: payment_events is UNIQUE on the event id, so
 * storing it would let a forgery claim a real event's id and get the genuine
 * delivery ignored as a duplicate. Once stored we answer 200; an event that
 * can't be applied keeps processed_at NULL with the reason in `error`, for
 * payment_sweep to retry and ops to see.
 */
@Injectable()
export class RazorpayWebhookService {
  private readonly logger = new Logger(RazorpayWebhookService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly capture: PaymentCaptureService,
    @Inject(ConfigService)
    private readonly config: { get(key: string): string | undefined },
  ) {}

  async handle(
    raw: Buffer | undefined,
    signature: string | undefined,
    eventId: string | undefined,
  ) {
    const secret = this.config.get('RAZORPAY_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error(
        'Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not set',
      );
      throw apiError(
        503,
        'WEBHOOK_NOT_CONFIGURED',
        'Webhook secret not configured',
      );
    }
    if (!raw || !signature || !this.signatureOk(raw, signature, secret)) {
      throw apiError(
        400,
        'SIGNATURE_INVALID',
        'Webhook signature does not match',
      );
    }
    if (!eventId)
      throw apiError(
        400,
        'VALIDATION_FAILED',
        'x-razorpay-event-id header is required',
      );

    const body = JSON.parse(raw.toString('utf8')) as WebhookBody;
    const [row]: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO "payment_events" ("event_id", "event_type", "payload", "signature_ok")
       VALUES ($1, $2, $3::jsonb, true)
       ON CONFLICT ("provider", "event_id") DO NOTHING RETURNING "id"`,
      [eventId, body.event, JSON.stringify(body.payload ?? {})],
    );
    if (row) await this.process(row.id, body.event, body.payload ?? {});
    return { received: true };
  }

  /** Apply one stored event; records processed_at or the reason it couldn't be applied. */
  async process(
    id: string,
    type: string,
    payload: WebhookBody['payload'],
  ): Promise<void> {
    let error: string | null;
    try {
      error = await this.apply(type, payload);
    } catch (e) {
      error = (e as Error).message;
    }
    if (error)
      this.logger.error(`Razorpay event ${type} (${id}) not applied: ${error}`);
    await this.dataSource.query(
      `UPDATE "payment_events" SET "processed_at" = CASE WHEN $2::text IS NULL THEN now() END, "error" = $2 WHERE "id" = $1`,
      [id, error],
    );
  }

  /** Returns null when handled, else why not. */
  private async apply(
    type: string,
    payload: WebhookBody['payload'],
  ): Promise<string | null> {
    if (type === 'payment.failed') return null; // stored = logged; the customer can retry on the same Razorpay order
    if (type !== 'payment.captured' && type !== 'order.paid')
      return `not handled yet: ${type}`;
    const e = payload.payment?.entity;
    if (!e) return 'no payment entity in payload';
    const r = await this.capture.recordCapture(
      {
        id: String(e.id),
        orderId: String(e.order_id),
        amount: Number(e.amount),
        currency: String(e.currency),
        status: String(e.status),
      },
      { type: 'webhook' },
    );
    return DONE.includes(r.outcome)
      ? null
      : `${r.outcome}${r.reason ? `: ${r.reason}` : ''}`;
  }

  private signatureOk(raw: Buffer, signature: string, secret: string): boolean {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(raw)
      .digest('hex');
    return (
      expected.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    );
  }
}
