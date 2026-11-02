import { HttpException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ENTITIES } from '../../entities';
import { OrderStateService } from './order-state.service';

/**
 * OrderStateService against a real Postgres (guarded UPDATE + order_events in
 * one transaction). Needs TEST_DATABASE_URL pointing at an EMPTY, disposable
 * local database — migrations run on it and tables are truncated between
 * tests. Skipped when the variable is unset; refuses non-local hosts so it can
 * never touch a shared database.
 */
const url = process.env.TEST_DATABASE_URL;
const isLocal = !!url && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
const suite = url && isLocal ? describe : describe.skip;

let seq = 0;
function orderId(): string {
  // 'IDO-' + 10 Crockford base32 characters
  return `IDO-TEST${String(++seq).padStart(6, '0')}`.slice(0, 14);
}

suite('OrderStateService (real Postgres)', () => {
  let ds: DataSource;
  let svc: OrderStateService;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url,
      entities: ENTITIES,
      migrations: [__dirname + '/../../migrations/*.ts'],
    });
    await ds.initialize();
    await ds.runMigrations();
    svc = new OrderStateService(ds);
  }, 120_000);

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    await ds.query('TRUNCATE "order_events", "orders" CASCADE');
  });

  async function insertOrder(
    status: string,
    cancelReason: string | null = null,
  ): Promise<string> {
    const id = orderId();
    await ds.query(
      `INSERT INTO "orders" ("id", "idempotency_key", "status", "cancel_reason", "payment_method", "finish",
         "unit_price", "list_price", "subtotal", "total", "kit_price_snapshot", "customer", "address")
       VALUES ($1, gen_random_uuid(), $2, $3, 'online', 'gold', 1499900, 1999900, 1499900, 1499900, 99900,
         '{"name":"Test","email":"t@example.com","phone":"9800000001"}', '{"line":"1 Test St","city":"Pune","state":"MH","pin":"411001"}')`,
      [id, status, cancelReason],
    );
    return id;
  }

  async function row(id: string) {
    const [r] = await ds.query(
      'SELECT "status", "cancel_reason" FROM "orders" WHERE "id" = $1',
      [id],
    );
    return r as { status: string; cancel_reason: string | null };
  }

  async function events(id: string) {
    return ds.query(
      'SELECT "event", "from_status", "to_status", "actor_type", "actor_user_id", "note", "meta" FROM "order_events" WHERE "order_id" = $1 ORDER BY "id"',
      [id],
    );
  }

  async function apiError(p: Promise<unknown>) {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      const err = e as HttpException;
      return {
        status: err.getStatus(),
        body: err.getResponse() as Record<string, unknown>,
      };
    }
    throw new Error('expected an error');
  }

  it('applies an allowed transition and records it in order_events', async () => {
    const id = await insertOrder('confirmed');
    const res = await svc.transition(
      id,
      'kit_shipped',
      { type: 'admin', userId: null },
      { note: 'AWB 123' },
    );

    expect(res).toEqual(
      expect.objectContaining({
        applied: true,
        from: 'confirmed',
        to: 'kit_shipped',
      }),
    );
    expect(await row(id)).toEqual({
      status: 'kit_shipped',
      cancel_reason: null,
    });
    expect(await events(id)).toEqual([
      expect.objectContaining({
        event: 'kit_shipped',
        from_status: 'confirmed',
        to_status: 'kit_shipped',
        actor_type: 'admin',
        note: 'AWB 123',
      }),
    ]);
  });

  it('writes the cancel reason together with the cancelled status', async () => {
    const id = await insertOrder('kit_delivered');
    await svc.transition(id, 'customer_cancel', {
      type: 'customer',
      userId: null,
    });
    expect(await row(id)).toEqual({
      status: 'cancelled',
      cancel_reason: 'customer',
    });
  });

  it('rejects an invalid move by a person with 409 INVALID_TRANSITION and changes nothing', async () => {
    const id = await insertOrder('ring_shipped');
    const err = await apiError(
      svc.transition(id, 'customer_cancel', { type: 'customer', userId: null }),
    );

    expect(err.status).toBe(409);
    expect(err.body).toEqual(
      expect.objectContaining({ statusCode: 409, code: 'INVALID_TRANSITION' }),
    );
    expect(await row(id)).toEqual({
      status: 'ring_shipped',
      cancel_reason: null,
    });
    expect(await events(id)).toEqual([]);
  });

  it('treats an invalid move by a job as a no-op (no error, no event)', async () => {
    const id = await insertOrder('confirmed'); // already paid
    const res = await svc.transition(id, 'payment_captured', {
      type: 'webhook',
      userId: null,
    });

    expect(res).toEqual(expect.objectContaining({ applied: false }));
    expect(await row(id)).toEqual({ status: 'confirmed', cancel_reason: null });
    expect(await events(id)).toEqual([]);
  });

  it('rejects the wrong actor with 403 FORBIDDEN', async () => {
    const id = await insertOrder('confirmed');
    const err = await apiError(
      svc.transition(id, 'kit_shipped', { type: 'customer', userId: null }),
    );
    expect(err.status).toBe(403);
    expect(err.body).toEqual(
      expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' }),
    );
  });

  it('returns 404 NOT_FOUND for an unknown order', async () => {
    const err = await apiError(
      svc.transition('IDO-NOSUCHORDR', 'kit_shipped', {
        type: 'admin',
        userId: null,
      }),
    );
    expect(err.status).toBe(404);
    expect(err.body).toEqual(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('lets exactly one of two concurrent requests win (the guarded UPDATE, not the pre-read)', async () => {
    const id = await insertOrder('confirmed');

    // A applies the move inside a transaction it keeps open (row now locked).
    const qrA = ds.createQueryRunner();
    await qrA.connect();
    await qrA.startTransaction();
    await svc.transition(
      id,
      'kit_shipped',
      { type: 'admin', userId: null },
      { manager: qrA.manager },
    );

    // B still reads the committed status 'confirmed', decides the move is
    // allowed, then blocks on A's row lock in its UPDATE.
    const b = svc
      .transition(id, 'kit_shipped', { type: 'admin', userId: null })
      .then(
        (v) => ({ ok: true as const, v }),
        (e: unknown) => ({ ok: false as const, e }),
      );
    for (let i = 0; i < 100; i++) {
      const [{ waiting }] = await ds.query(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`,
      );
      if (waiting > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    await qrA.commitTransaction();
    await qrA.release();
    const res = await b;

    expect(res.ok).toBe(false);
    expect((res as { e: HttpException }).e.getResponse()).toEqual(
      expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    );
    expect(await events(id)).toHaveLength(1);
    expect(await row(id)).toEqual({
      status: 'kit_shipped',
      cancel_reason: null,
    });
  });

  it('records a cancel during kit_shipped as an RTO request without changing the status', async () => {
    const id = await insertOrder('kit_shipped');
    const res = await svc.transition(id, 'customer_cancel', {
      type: 'customer',
      userId: null,
    });

    expect(res).toEqual(
      expect.objectContaining({
        applied: true,
        from: 'kit_shipped',
        to: 'kit_shipped',
        outcome: 'rto_requested',
      }),
    );
    expect(await row(id)).toEqual({
      status: 'kit_shipped',
      cancel_reason: null,
    });
    expect(await events(id)).toEqual([
      expect.objectContaining({
        event: 'customer_cancel',
        from_status: 'kit_shipped',
        to_status: 'kit_shipped',
        meta: { outcome: 'rto_requested' },
      }),
    ]);
  });

  it('joins a caller transaction, so a later failure rolls the status back too', async () => {
    const id = await insertOrder('confirmed');
    await expect(
      ds.transaction(async (manager) => {
        await svc.transition(
          id,
          'kit_shipped',
          { type: 'admin', userId: null },
          { manager },
        );
        throw new Error('side effect failed');
      }),
    ).rejects.toThrow('side effect failed');

    expect(await row(id)).toEqual({ status: 'confirmed', cancel_reason: null });
    expect(await events(id)).toEqual([]);
  });
});
