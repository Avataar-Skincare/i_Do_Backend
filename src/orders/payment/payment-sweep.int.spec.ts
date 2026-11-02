import { DataSource } from 'typeorm';
import { ENTITIES } from '../../entities';
import { SettingsService } from '../../settings/settings.service';
import { OrderCreationService } from '../create/order-creation.service';
import { OrderStateService } from '../state/order-state.service';
import type { GatewayPayment, PaymentGateway } from './payment-gateway';
import { PaymentCaptureService } from './payment-capture.service';
import { PaymentSweepService, SWEEP_LOCK_KEY } from './payment-sweep.service';
import { RazorpayWebhookService } from './razorpay-webhook.service';

/**
 * payment_sweep (LLD §3.1 transition 3, TD-9): online orders still
 * pending_payment after `pending_payment_ttl_hours` — ask Razorpay; captured
 * → confirm (the webhook was missed), nothing → cancel as unpaid. Also
 * retries webhook events that failed to apply. Real Postgres, fake Razorpay.
 */
const url = process.env.TEST_DATABASE_URL;
const isLocal = !!url && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
const suite = url && isLocal ? describe : describe.skip;

let rzpSeq = 0;

class FakeRazorpay implements PaymentGateway {
  keyId = 'rzp_test_FAKE';
  /** Payments per Razorpay order id; a missing entry = no attempts. */
  byOrder = new Map<string, GatewayPayment[]>();
  down = false;
  asked: string[] = [];
  async createOrder(amount: number) {
    return { id: `order_SWP${++rzpSeq}`, amount, currency: 'INR' };
  }
  async fetchOrderPayments(id: string) {
    this.asked.push(id);
    if (this.down) throw new Error('razorpay is down');
    return this.byOrder.get(id) ?? [];
  }
  async fetchPayment(): Promise<GatewayPayment> {
    throw new Error('not used by the sweep');
  }
  verifySignature(): boolean {
    throw new Error('not used by the sweep');
  }
}

suite('PaymentSweepService (real Postgres)', () => {
  const dbName = `ido_sweep_${Date.now()}`;
  let admin: DataSource;
  let ds: DataSource;
  let rzp: FakeRazorpay;
  let creation: OrderCreationService;
  let capture: PaymentCaptureService;
  let sweep: PaymentSweepService;
  let userId: string;
  let seq = 0;

  const newOrder = async (
    ageHours: number,
    paymentMethod: 'online' | 'cod' = 'online',
  ) => {
    const r = await creation.create(
      userId,
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
    const id = r.body.order.id;
    await ds.query(
      `UPDATE "orders" SET "created_at" = now() - make_interval(hours => $2) WHERE "id" = $1`,
      [id, ageHours],
    );
    return {
      id,
      total: r.body.order.total,
      rzpOrderId: r.body.razorpay?.id as string,
    };
  };
  const paid = (
    rzpOrderId: string,
    amount: number,
    status = 'captured',
  ): GatewayPayment => ({
    id: `pay_${rzpOrderId}_${status}`,
    orderId: rzpOrderId,
    amount,
    currency: 'INR',
    status,
  });
  const order = async (id: string) =>
    (
      await ds.query(
        'SELECT "status", "cancel_reason" FROM "orders" WHERE "id" = $1',
        [id],
      )
    )[0];
  const events = async (id: string) =>
    (await ds.query(
      'SELECT "event", "actor_type" FROM "order_events" WHERE "order_id" = $1 AND "event" <> $2',
      [id, 'order_created'],
    )) as unknown[];

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
    [{ id: userId }] = await ds.query(
      `INSERT INTO "users" ("phone") VALUES ('9800000001') RETURNING "id"`,
    );
  }, 180_000);

  beforeEach(async () => {
    // Each test sees only its own orders: earlier tests' leftovers are made not-due.
    await ds.query(
      `UPDATE "orders" SET "created_at" = now() WHERE "status" = 'pending_payment'`,
    );
    await ds.query(
      `UPDATE "payment_events" SET "processed_at" = now() WHERE "processed_at" IS NULL`,
    );
    await ds.query(
      `UPDATE "settings" SET "value" = '24'::jsonb WHERE "key" = 'pending_payment_ttl_hours'`,
    );
    rzp = new FakeRazorpay();
    const state = new OrderStateService(ds);
    const settings = new SettingsService(ds);
    creation = new OrderCreationService(ds, settings, rzp);
    capture = new PaymentCaptureService(ds, state);
    const webhook = new RazorpayWebhookService(ds, capture, {
      get: () => 'unused',
    });
    sweep = new PaymentSweepService(ds, settings, capture, state, webhook, rzp);
  });

  afterAll(async () => {
    await ds?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin?.destroy();
  });

  it('25 h old, nothing paid on Razorpay → cancelled(unpaid) by the system', async () => {
    const o = await newOrder(25);
    const r = await sweep.run();
    expect(r).toEqual(expect.objectContaining({ expired: 1, confirmed: 0 }));
    expect(await order(o.id)).toEqual({
      status: 'cancelled',
      cancel_reason: 'unpaid',
    });
    expect(await events(o.id)).toEqual([
      { event: 'unpaid_expired', actor_type: 'system' },
    ]);
  });

  it('23 h old → untouched; Razorpay not even asked', async () => {
    const o = await newOrder(23);
    await sweep.run();
    expect((await order(o.id)).status).toBe('pending_payment');
    expect(rzp.asked).toEqual([]);
  });

  it('25 h old but Razorpay shows it captured (webhook missed) → confirmed, not cancelled', async () => {
    const o = await newOrder(25);
    rzp.byOrder.set(o.rzpOrderId, [
      paid(o.rzpOrderId, o.total, 'failed'),
      paid(o.rzpOrderId, o.total),
    ]);
    const r = await sweep.run();
    expect(r).toEqual(expect.objectContaining({ confirmed: 1, expired: 0 }));
    expect((await order(o.id)).status).toBe('confirmed');
    expect(await events(o.id)).toEqual([
      { event: 'payment_captured', actor_type: 'system' },
    ]);
  });

  it('only authorized (capture in flight) → left pending for the next run', async () => {
    const o = await newOrder(25);
    rzp.byOrder.set(o.rzpOrderId, [paid(o.rzpOrderId, o.total, 'authorized')]);
    await sweep.run();
    expect((await order(o.id)).status).toBe('pending_payment');
  });

  it('Razorpay unreachable → never cancel blind: left pending', async () => {
    const o = await newOrder(25);
    rzp.down = true;
    const r = await sweep.run();
    expect(r).toEqual(expect.objectContaining({ skipped: 1, expired: 0 }));
    expect((await order(o.id)).status).toBe('pending_payment');
  });

  it('the TTL comes from settings (ops can change it)', async () => {
    await ds.query(
      `UPDATE "settings" SET "value" = '1'::jsonb WHERE "key" = 'pending_payment_ttl_hours'`,
    );
    const o = await newOrder(2);
    await sweep.run();
    expect((await order(o.id)).status).toBe('cancelled');
  });

  it('COD orders are not the sweep’s business', async () => {
    const o = await newOrder(48, 'cod');
    await sweep.run();
    expect((await order(o.id)).status).toBe('cod_pending');
  });

  it('a stored capture event that failed to apply earlier is retried and applied', async () => {
    const o = await newOrder(1);
    const p = paid(o.rzpOrderId, o.total);
    const payload = {
      payment: {
        entity: {
          id: p.id,
          order_id: p.orderId,
          amount: p.amount,
          currency: 'INR',
          status: 'captured',
        },
      },
    };
    const [{ id }] = await ds.query(
      `INSERT INTO "payment_events" ("event_id", "event_type", "payload", "signature_ok", "error")
       VALUES ($1, 'payment.captured', $2::jsonb, true, 'connection reset') RETURNING "id"`,
      [`evt_retry_${seq}`, JSON.stringify(payload)],
    );

    const r = await sweep.run();
    expect(r).toEqual(expect.objectContaining({ eventsRetried: 1 }));
    expect((await order(o.id)).status).toBe('confirmed');
    const [ev] = await ds.query(
      'SELECT ("processed_at" IS NOT NULL) AS processed, "error" FROM "payment_events" WHERE "id" = $1',
      [id],
    );
    expect(ev).toEqual({ processed: true, error: null });
  });

  it('another instance already sweeping (advisory lock held) → this run does nothing', async () => {
    const o = await newOrder(25);
    const other = ds.createQueryRunner();
    await other.connect();
    await other.query('SELECT pg_advisory_lock($1)', [SWEEP_LOCK_KEY]);
    try {
      const r = await sweep.run();
      expect(r).toEqual({ locked: true });
      expect((await order(o.id)).status).toBe('pending_payment');
    } finally {
      await other.query('SELECT pg_advisory_unlock($1)', [SWEEP_LOCK_KEY]);
      await other.release();
    }
  });
});
