import { HttpException } from '@nestjs/common';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { ENTITIES } from '../../entities';
import { SettingsService } from '../../settings/settings.service';
import { OrderCreationService } from '../create/order-creation.service';
import { OrderStateService } from '../state/order-state.service';
import type { GatewayPayment, PaymentGateway } from './payment-gateway';
import { PaymentCaptureService } from './payment-capture.service';
import { PaymentVerifyService } from './payment-verify.service';
import { RazorpayWebhookService } from './razorpay-webhook.service';

/**
 * LLD §3.1 transition 2 (pending_payment → confirmed) from all three doors:
 * the browser's /payment/verify, the Razorpay webhook, and the shared capture
 * rule underneath — against a real Postgres. Razorpay is a fake.
 */
const url = process.env.TEST_DATABASE_URL;
const isLocal = !!url && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
const suite = url && isLocal ? describe : describe.skip;

const KEY_SECRET = 'test_key_secret';
const WEBHOOK_SECRET = 'test_webhook_secret';
let rzpSeq = 0;

class FakeRazorpay implements PaymentGateway {
  keyId = 'rzp_test_FAKE';
  /** What fetchPayment returns, by payment id. */
  payments = new Map<string, GatewayPayment>();
  async createOrder(amount: number) {
    return { id: `order_PAY${++rzpSeq}`, amount, currency: 'INR' };
  }
  async fetchPayment(id: string) {
    const p = this.payments.get(id);
    if (!p) throw new Error('razorpay: payment not found');
    return p;
  }
  async fetchOrderPayments(): Promise<GatewayPayment[]> {
    throw new Error('not used here');
  }
  verifySignature(orderId: string, paymentId: string, signature: string) {
    return signature === sign(`${orderId}|${paymentId}`, KEY_SECRET);
  }
}

const sign = (data: string | Buffer, secret: string) =>
  crypto.createHmac('sha256', secret).update(data).digest('hex');

suite('Payment capture, verify and webhook (real Postgres)', () => {
  const dbName = `ido_pay_${Date.now()}`;
  let admin: DataSource;
  let ds: DataSource;
  let rzp: FakeRazorpay;
  let creation: OrderCreationService;
  let state: OrderStateService;
  let capture: PaymentCaptureService;
  let verify: PaymentVerifyService;
  let webhook: RazorpayWebhookService;
  let userA: string;
  let userB: string;
  let seq = 0;

  const newOrder = async (paymentMethod: 'online' | 'cod' = 'online') => {
    const r = await creation.create(
      userA,
      `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
      {
        finish: 'gold',
        paymentMethod,
        customer: {
          name: 'Ananya Sharma',
          email: 'ananya@example.com',
          phone: '9800000001',
        },
        address: {
          line: '12 MG Road',
          city: 'Pune',
          state: 'Maharashtra',
          pin: '411001',
        },
      },
    );
    return {
      id: r.body.order.id,
      total: r.body.order.total,
      rzpOrderId: r.body.razorpay?.id as string,
    };
  };
  const payment = (
    rzpOrderId: string,
    amount: number,
    over: Partial<GatewayPayment> = {},
  ): GatewayPayment => ({
    id: `pay_${rzpOrderId}_${++seq}`,
    orderId: rzpOrderId,
    amount,
    currency: 'INR',
    status: 'captured',
    ...over,
  });
  const order = async (id: string) =>
    (
      await ds.query(
        'SELECT "status", "cancel_reason", "amount_paid" FROM "orders" WHERE "id" = $1',
        [id],
      )
    )[0];
  const pay = async (id: string) =>
    (
      await ds.query(
        'SELECT "status", "razorpay_payment_id", ("captured_at" IS NOT NULL) AS captured FROM "payments" WHERE "order_id" = $1',
        [id],
      )
    )[0];
  const events = async (id: string, event: string) =>
    (await ds.query(
      'SELECT "actor_type" FROM "order_events" WHERE "order_id" = $1 AND "event" = $2',
      [id, event],
    )) as Array<{ actor_type: string }>;
  async function apiError(p: Promise<unknown>) {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      return {
        status: (e as HttpException).getStatus(),
        body: (e as HttpException).getResponse() as Record<string, unknown>,
      };
    }
    throw new Error('expected an error');
  }

  beforeAll(async () => {
    admin = new DataSource({ type: 'postgres', url });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    ds = new DataSource({
      type: 'postgres',
      url: url!.replace(/\/[^/]+$/, `/${dbName}`),
      entities: ENTITIES,
      migrations: [__dirname + '/../../migrations/*.ts'],
    });
    await ds.initialize();
    await ds.runMigrations();
    await ds.query(
      `UPDATE "settings" SET "value" = '99900'::jsonb WHERE "key" = 'kit_price_paise'`,
    );
    await ds.query(
      `UPDATE "settings" SET "value" = "value" || '{"gstin":"27AAACM1234A1Z5","state":"Maharashtra"}'::jsonb WHERE "key" = 'seller'`,
    );
    await ds.query(
      `UPDATE "settings" SET "value" = '"85176290"'::jsonb WHERE "key" = 'hsn_code'`,
    );
    await ds.query(
      `UPDATE "settings" SET "value" = '{"email":"support@idowellness.ai","phone":"9800000009","whatsapp":null}'::jsonb WHERE "key" = 'support_contacts'`,
    );
    [{ id: userA }] = await ds.query(
      `INSERT INTO "users" ("phone") VALUES ('9800000001') RETURNING "id"`,
    );
    [{ id: userB }] = await ds.query(
      `INSERT INTO "users" ("phone") VALUES ('9800000002') RETURNING "id"`,
    );
  }, 180_000);

  beforeEach(() => {
    rzp = new FakeRazorpay();
    state = new OrderStateService(ds);
    creation = new OrderCreationService(ds, new SettingsService(ds), rzp);
    capture = new PaymentCaptureService(ds, state);
    verify = new PaymentVerifyService(ds, capture, rzp);
    webhook = new RazorpayWebhookService(ds, capture, {
      get: () => WEBHOOK_SECRET,
    });
  });

  afterAll(async () => {
    await ds?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin?.destroy();
  });

  describe('recordCapture (the one rule all three doors use)', () => {
    it('pending order + matching capture → confirmed, amount_paid = total, payment captured, one event', async () => {
      const o = await newOrder();
      const p = payment(o.rzpOrderId, o.total);
      const r = await capture.recordCapture(p, { type: 'webhook' });

      expect(r.outcome).toBe('confirmed');
      expect(await order(o.id)).toEqual({
        status: 'confirmed',
        cancel_reason: null,
        amount_paid: o.total,
      });
      expect(await pay(o.id)).toEqual({
        status: 'captured',
        razorpay_payment_id: p.id,
        captured: true,
      });
      expect(await events(o.id, 'payment_captured')).toEqual([
        { actor_type: 'webhook' },
      ]);
    });

    it('the same capture again (webhook retry, or verify after the webhook) → already_recorded, nothing changes', async () => {
      const o = await newOrder();
      const p = payment(o.rzpOrderId, o.total);
      await capture.recordCapture(p, { type: 'webhook' });
      const again = await capture.recordCapture(p, {
        type: 'customer',
        userId: userA,
      });

      expect(again.outcome).toBe('already_recorded');
      expect(await events(o.id, 'payment_captured')).toHaveLength(1);
    });

    it('verify arriving while the webhook is mid-capture waits, then sees it done (no error, confirmed once)', async () => {
      // Pauses the webhook's transaction just before the status change, with the payment row locked.
      let release!: () => void;
      const hold = new Promise<void>((r) => (release = r));
      let entered = 0;
      class PausingState extends OrderStateService {
        async transition(...args: Parameters<OrderStateService['transition']>) {
          if (++entered === 1) await hold;
          return super.transition(...args);
        }
      }
      const paused = new PaymentCaptureService(ds, new PausingState(ds));
      const until = async (
        cond: () => Promise<boolean> | boolean,
        what: string,
      ) => {
        for (let i = 0; i < 200; i++) {
          if (await cond()) return;
          await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error(`timed out waiting for: ${what}`);
      };

      const o = await newOrder();
      const p = payment(o.rzpOrderId, o.total);
      const webhookSide = paused.recordCapture(p, { type: 'webhook' });
      await until(
        () => entered === 1,
        'the webhook to reach the status change',
      );
      const verifySide = paused.recordCapture(p, {
        type: 'customer',
        userId: userA,
      });
      await until(
        async () =>
          (
            await ds.query(
              `SELECT 1 FROM pg_stat_activity WHERE "wait_event_type" = 'Lock'`,
            )
          ).length === 1,
        'verify to block on a row lock',
      );
      release();

      expect((await webhookSide).outcome).toBe('confirmed');
      expect((await verifySide).outcome).toBe('already_recorded');
      expect(await events(o.id, 'payment_captured')).toEqual([
        { actor_type: 'webhook' },
      ]);
    });

    it.each([
      ['amount short by ₹1', { amount: 1499800 }],
      ['wrong currency', { currency: 'USD' }],
    ])(
      '%s → mismatch: order stays pending_payment, payment not marked captured',
      async (_n, over) => {
        const o = await newOrder();
        const r = await capture.recordCapture(
          payment(o.rzpOrderId, o.total, over),
          { type: 'webhook' },
        );
        expect(r.outcome).toBe('mismatch');
        expect((await order(o.id)).status).toBe('pending_payment');
        expect((await pay(o.id)).status).toBe('created');
      },
    );

    it('a Razorpay order we never created → unknown_order', async () => {
      const r = await capture.recordCapture(
        payment('order_NOT_OURS', 1499900),
        { type: 'webhook' },
      );
      expect(r.outcome).toBe('unknown_order');
    });

    it('capture after the 24 h expiry → order stays cancelled(unpaid); full late_capture refund, once', async () => {
      const o = await newOrder();
      await state.transition(o.id, 'unpaid_expired', { type: 'system' });
      const p = payment(o.rzpOrderId, o.total);

      const r = await capture.recordCapture(p, { type: 'webhook' });
      await capture.recordCapture(p, { type: 'webhook' });

      expect(r.outcome).toBe('late_capture_refund');
      expect(await order(o.id)).toEqual({
        status: 'cancelled',
        cancel_reason: 'unpaid',
        amount_paid: o.total,
      });
      const refunds = await ds.query(
        'SELECT "reason", "amount_paid", "amount", "method", "status" FROM "refunds" WHERE "order_id" = $1',
        [o.id],
      );
      expect(refunds).toEqual([
        {
          reason: 'late_capture',
          amount_paid: o.total,
          amount: o.total,
          method: 'razorpay',
          status: 'requested',
        },
      ]);
      expect(await events(o.id, 'late_capture')).toEqual([
        { actor_type: 'webhook' },
      ]);
    });
  });

  describe('POST /orders/:id/payment/verify', () => {
    const body = (rzpOrderId: string, paymentId: string, sig?: string) => ({
      razorpayOrderId: rzpOrderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: sig ?? sign(`${rzpOrderId}|${paymentId}`, KEY_SECRET),
    });

    it('signature OK and Razorpay says captured → the order comes back confirmed', async () => {
      const o = await newOrder();
      const p = payment(o.rzpOrderId, o.total);
      rzp.payments.set(p.id, p);

      const view = await verify.verify(userA, o.id, body(o.rzpOrderId, p.id));
      expect(view.status).toBe('confirmed');
      expect(view.amountPaid).toBe(o.total);
      expect(await events(o.id, 'payment_captured')).toEqual([
        { actor_type: 'customer' },
      ]);
    });

    it('signature OK but only authorized → still pending_payment (keep polling); payment marked authorized', async () => {
      const o = await newOrder();
      const p = payment(o.rzpOrderId, o.total, { status: 'authorized' });
      rzp.payments.set(p.id, p);

      const view = await verify.verify(userA, o.id, body(o.rzpOrderId, p.id));
      expect(view.status).toBe('pending_payment');
      expect(await pay(o.id)).toEqual({
        status: 'authorized',
        razorpay_payment_id: p.id,
        captured: false,
      });
    });

    it('Razorpay unreachable after a good signature → the order as it is (the webhook will confirm)', async () => {
      const o = await newOrder();
      const view = await verify.verify(
        userA,
        o.id,
        body(o.rzpOrderId, 'pay_UNKNOWN'),
      );
      expect(view.status).toBe('pending_payment');
    });

    it('wrong signature → 400 SIGNATURE_INVALID, nothing changes', async () => {
      const o = await newOrder();
      const p = payment(o.rzpOrderId, o.total);
      rzp.payments.set(p.id, p);
      const err = await apiError(
        verify.verify(userA, o.id, body(o.rzpOrderId, p.id, 'f'.repeat(64))),
      );
      expect(err.status).toBe(400);
      expect(err.body).toEqual(
        expect.objectContaining({ code: 'SIGNATURE_INVALID' }),
      );
      expect((await order(o.id)).status).toBe('pending_payment');
    });

    it("a Razorpay order id that isn't this order's → 400 SIGNATURE_INVALID", async () => {
      const o1 = await newOrder();
      const o2 = await newOrder();
      const p = payment(o2.rzpOrderId, o2.total);
      rzp.payments.set(p.id, p);
      const err = await apiError(
        verify.verify(userA, o1.id, body(o2.rzpOrderId, p.id)),
      );
      expect(err.body).toEqual(
        expect.objectContaining({ code: 'SIGNATURE_INVALID' }),
      );
      expect((await order(o2.id)).status).toBe('pending_payment');
    });

    it("someone else's order → 404", async () => {
      const o = await newOrder();
      const p = payment(o.rzpOrderId, o.total);
      const err = await apiError(
        verify.verify(userB, o.id, body(o.rzpOrderId, p.id)),
      );
      expect(err.status).toBe(404);
    });
  });

  describe('POST /webhooks/razorpay', () => {
    const deliver = (
      event: string,
      entity: Record<string, unknown>,
      eventId = `evt_${++seq}`,
      secret = WEBHOOK_SECRET,
    ) => {
      const raw = Buffer.from(
        JSON.stringify({ event, payload: { payment: { entity } } }),
      );
      return {
        eventId,
        run: () => webhook.handle(raw, sign(raw, secret), eventId),
      };
    };
    const entity = (p: GatewayPayment) => ({
      id: p.id,
      order_id: p.orderId,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
    });
    const stored = async (eventId: string) =>
      (
        await ds.query(
          'SELECT "event_type", "signature_ok", ("processed_at" IS NOT NULL) AS processed, "error" FROM "payment_events" WHERE "event_id" = $1',
          [eventId],
        )
      )[0];

    it('payment.captured → stored, processed, order confirmed by the webhook', async () => {
      const o = await newOrder();
      const d = deliver(
        'payment.captured',
        entity(payment(o.rzpOrderId, o.total)),
      );
      expect(await d.run()).toEqual({ received: true });
      expect(await stored(d.eventId)).toEqual({
        event_type: 'payment.captured',
        signature_ok: true,
        processed: true,
        error: null,
      });
      expect((await order(o.id)).status).toBe('confirmed');
    });

    it('order.paid works the same way', async () => {
      const o = await newOrder();
      await deliver('order.paid', entity(payment(o.rzpOrderId, o.total))).run();
      expect((await order(o.id)).status).toBe('confirmed');
    });

    it('the same event id delivered twice → 200 both times, stored and processed once', async () => {
      const o = await newOrder();
      const d = deliver(
        'payment.captured',
        entity(payment(o.rzpOrderId, o.total)),
      );
      await d.run();
      await d.run();
      expect(
        await ds.query('SELECT 1 FROM "payment_events" WHERE "event_id" = $1', [
          d.eventId,
        ]),
      ).toHaveLength(1);
      expect(await events(o.id, 'payment_captured')).toHaveLength(1);
    });

    it('bad signature → 400 SIGNATURE_INVALID and nothing stored (a forged event must not claim the real event id)', async () => {
      const o = await newOrder();
      const d = deliver(
        'payment.captured',
        entity(payment(o.rzpOrderId, o.total)),
        undefined,
        'not_the_secret',
      );
      const err = await apiError(d.run());
      expect(err.status).toBe(400);
      expect(err.body).toEqual(
        expect.objectContaining({ code: 'SIGNATURE_INVALID' }),
      );
      expect(await stored(d.eventId)).toBeUndefined();
      expect((await order(o.id)).status).toBe('pending_payment');
    });

    it('payment.failed → stored and processed (logged only); order stays pending for a retry', async () => {
      const o = await newOrder();
      const d = deliver(
        'payment.failed',
        entity(payment(o.rzpOrderId, o.total, { status: 'failed' })),
      );
      await d.run();
      expect(await stored(d.eventId)).toEqual(
        expect.objectContaining({ processed: true, error: null }),
      );
      expect((await order(o.id)).status).toBe('pending_payment');
    });

    it('a capture that cannot be applied (unknown order) → still 200, stored unprocessed with the reason', async () => {
      const d = deliver(
        'payment.captured',
        entity(payment('order_NOT_OURS', 1499900)),
      );
      expect(await d.run()).toEqual({ received: true });
      const s = await stored(d.eventId);
      expect(s.processed).toBe(false);
      expect(s.error).toContain('unknown_order');
    });
  });
});
