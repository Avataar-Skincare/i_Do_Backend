import { HttpException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ENTITIES } from '../../entities';
import { SettingsService } from '../../settings/settings.service';
import {
  CreateOrderInput,
  OrderCreationService,
} from './order-creation.service';
import type { PaymentGateway } from '../payment/payment-gateway';

/**
 * POST /orders against a real Postgres (own database, migrations applied).
 * Razorpay is a fake: no network, and the test sees exactly what was asked of it.
 */
const url = process.env.TEST_DATABASE_URL;
const isLocal = !!url && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
const suite = url && isLocal ? describe : describe.skip;

// Razorpay order ids are unique in `payments`, so the fake numbers them across the whole file.
let fakeSeq = 0;

class FakeRazorpay implements PaymentGateway {
  keyId = 'rzp_test_FAKE';
  calls: Array<{ amount: number; receipt: string }> = [];
  failNext = false;
  /** Set to make createOrder wait (mid-transaction) until the test releases it. */
  hold: Promise<void> | null = null;
  entered = 0;
  async createOrder(amount: number, receipt: string) {
    this.entered++;
    if (this.hold) await this.hold;
    if (this.failNext) {
      this.failNext = false;
      throw new Error('razorpay is down');
    }
    this.calls.push({ amount, receipt });
    return { id: `order_FAKE${++fakeSeq}`, amount, currency: 'INR' };
  }
  fetchPayment(): never {
    throw new Error('not used by POST /orders');
  }
  verifySignature(): never {
    throw new Error('not used by POST /orders');
  }
  fetchOrderPayments(): never {
    throw new Error('not used by POST /orders');
  }
}

const input = (over: Partial<CreateOrderInput> = {}): CreateOrderInput => ({
  finish: 'gold',
  paymentMethod: 'online',
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
  ...over,
});

suite('OrderCreationService (real Postgres)', () => {
  const dbName = `ido_create_${Date.now()}`;
  let admin: DataSource;
  let ds: DataSource;
  let rzp: FakeRazorpay;
  let svc: OrderCreationService;
  let userA: string;
  let userB: string;
  let seq = 0;
  const key = () =>
    `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

  async function setLaunchReady(ready: boolean) {
    await ds.query(
      `UPDATE "settings" SET "value" = $1::jsonb WHERE "key" = 'kit_price_paise'`,
      [ready ? '99900' : 'null'],
    );
    await ds.query(
      `UPDATE "settings" SET "value" = $1::jsonb WHERE "key" = 'hsn_code'`,
      [ready ? '"85176290"' : 'null'],
    );
    await ds.query(
      `UPDATE "settings" SET "value" = "value" || $1::jsonb WHERE "key" = 'seller'`,
      [
        ready
          ? '{"gstin":"27AAACM1234A1Z5","state":"Maharashtra"}'
          : '{"gstin":null,"state":null}',
      ],
    );
    await ds.query(
      `UPDATE "settings" SET "value" = $1::jsonb WHERE "key" = 'support_contacts'`,
      [
        ready
          ? '{"email":"support@idowellness.ai","phone":"9800000009","whatsapp":null}'
          : '{"email":null,"phone":null,"whatsapp":null}',
      ],
    );
  }

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

  const orderCount = async (userId: string) =>
    Number(
      (
        await ds.query(
          'SELECT count(*) AS n FROM "orders" WHERE "user_id" = $1',
          [userId],
        )
      )[0].n,
    );

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
    [{ id: userA }] = await ds.query(
      `INSERT INTO "users" ("phone") VALUES ('9800000001') RETURNING "id"`,
    );
    [{ id: userB }] = await ds.query(
      `INSERT INTO "users" ("phone") VALUES ('9800000002') RETURNING "id"`,
    );
  }, 180_000);

  beforeEach(async () => {
    rzp = new FakeRazorpay();
    svc = new OrderCreationService(ds, new SettingsService(ds), rzp);
    await setLaunchReady(true);
    await ds.query(
      `UPDATE "settings" SET "value" = 'true'::jsonb WHERE "key" = 'cod_enabled'`,
    );
  });

  afterAll(async () => {
    await ds?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin?.destroy();
  });

  it('online: 201, pending_payment, server prices, a payment row and a Razorpay order for the exact total', async () => {
    const res = await svc.create(userA, key(), input());

    expect(res.created).toBe(true);
    const o = res.body.order;
    expect(o.id).toMatch(/^IDO-[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(o).toEqual(
      expect.objectContaining({
        status: 'pending_payment',
        paymentMethod: 'online',
        finish: 'gold',
        unitPrice: 1499900,
        listPrice: 1999900,
        subtotal: 1499900,
        codFee: 0,
        discount: 0,
        total: 1499900,
        amountPaid: 0,
        kitPriceSnapshot: 99900,
        shipments: [],
        refund: null,
      }),
    );
    expect(rzp.calls).toEqual([{ amount: 1499900, receipt: o.id }]);
    expect(res.body.razorpay).toEqual({
      id: expect.stringMatching(/^order_FAKE\d+$/),
      amount: 1499900,
      currency: 'INR',
      keyId: 'rzp_test_FAKE',
    });

    const [pay] = await ds.query(
      'SELECT "method", "amount", "status", "razorpay_order_id" FROM "payments" WHERE "order_id" = $1',
      [o.id],
    );
    expect(pay).toEqual({
      method: 'razorpay',
      amount: 1499900,
      status: 'created',
      razorpay_order_id: res.body.razorpay!.id,
    });
    const [ev] = await ds.query(
      'SELECT "event", "from_status", "to_status", "actor_type" FROM "order_events" WHERE "order_id" = $1',
      [o.id],
    );
    expect(ev).toEqual({
      event: 'order_created',
      from_status: null,
      to_status: 'pending_payment',
      actor_type: 'customer',
    });
  });

  it('COD: 201, cod_pending, ₹100 fee, no Razorpay order', async () => {
    const res = await svc.create(userA, key(), input({ paymentMethod: 'cod' }));
    expect(res.body.order).toEqual(
      expect.objectContaining({
        status: 'cod_pending',
        codFee: 10000,
        total: 1509900,
      }),
    );
    expect(res.body.razorpay).toBeUndefined();
    expect(rzp.calls).toEqual([]);
  });

  it('retry with the same key and details → 200 with the same order; Razorpay called once', async () => {
    const k = key();
    const first = await svc.create(userA, k, input());
    const again = await svc.create(userA, k, input());

    expect(again.created).toBe(false);
    expect(again.body.order.id).toBe(first.body.order.id);
    expect(again.body.razorpay).toEqual(first.body.razorpay);
    expect(rzp.calls).toHaveLength(1);
  });

  it('same key with a different finish → 409 IDEMPOTENCY_KEY_REUSED, still one order', async () => {
    const k = key();
    await svc.create(userA, k, input({ finish: 'gold' }));
    const before = await orderCount(userA);

    const err = await apiError(
      svc.create(userA, k, input({ finish: 'silver' })),
    );
    expect(err.status).toBe(409);
    expect(err.body).toEqual(
      expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }),
    );
    expect(await orderCount(userA)).toBe(before);
  });

  it('keys are per customer: the same key from another customer is a separate order', async () => {
    const k = key();
    const a = await svc.create(userA, k, input());
    const b = await svc.create(userB, k, input());
    expect(b.created).toBe(true);
    expect(b.body.order.id).not.toBe(a.body.order.id);
  });

  it('a duplicate arriving while the first is still talking to Razorpay waits, then gets the same order', async () => {
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
    const k = key();
    const before = await orderCount(userA);
    let release!: () => void;
    rzp.hold = new Promise((r) => (release = r));

    // Request 1 has inserted its order row and is waiting on Razorpay (transaction open).
    const p1 = svc.create(userA, k, input());
    await until(() => rzp.entered === 1, 'request 1 to reach Razorpay');
    // Request 2 saw no committed order, so it tries to insert and blocks on the unique index.
    const p2 = svc.create(userA, k, input());
    await until(
      async () =>
        (
          await ds.query(
            `SELECT 1 FROM pg_stat_activity WHERE "wait_event_type" = 'Lock' AND "query" LIKE 'INSERT INTO "orders"%'`,
          )
        ).length === 1,
      'request 2 to block on the (user_id, idempotency_key) index',
    );
    release();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false);
    expect(r2.body.order.id).toBe(r1.body.order.id);
    expect(r2.body.razorpay).toEqual(r1.body.razorpay);
    expect(rzp.calls).toHaveLength(1);
    expect(await orderCount(userA)).toBe(before + 1);
  });

  it('store not configured → 503 STORE_NOT_LIVE naming what is missing; nothing saved', async () => {
    await setLaunchReady(false);
    const before = await orderCount(userA);
    const err = await apiError(svc.create(userA, key(), input()));
    expect(err.status).toBe(503);
    expect(err.body).toEqual(
      expect.objectContaining({ code: 'STORE_NOT_LIVE' }),
    );
    expect(String(err.body.message)).toContain('kit_price_paise');
    expect(await orderCount(userA)).toBe(before);
    expect(rzp.calls).toEqual([]);
  });

  it('COD not available → 409 COD_NOT_SERVICEABLE; nothing saved', async () => {
    await ds.query(
      `UPDATE "settings" SET "value" = 'false'::jsonb WHERE "key" = 'cod_enabled'`,
    );
    const before = await orderCount(userA);
    const err = await apiError(
      svc.create(userA, key(), input({ paymentMethod: 'cod' })),
    );
    expect(err.status).toBe(409);
    expect(err.body).toEqual(
      expect.objectContaining({ code: 'COD_NOT_SERVICEABLE' }),
    );
    expect(await orderCount(userA)).toBe(before);
  });

  it('Razorpay failing → 503 PAYMENT_GATEWAY_UNAVAILABLE and no order is left behind', async () => {
    rzp.failNext = true;
    const before = await orderCount(userA);
    const err = await apiError(svc.create(userA, key(), input()));
    expect(err.status).toBe(503);
    expect(err.body).toEqual(
      expect.objectContaining({ code: 'PAYMENT_GATEWAY_UNAVAILABLE' }),
    );
    expect(await orderCount(userA)).toBe(before);
  });
});
