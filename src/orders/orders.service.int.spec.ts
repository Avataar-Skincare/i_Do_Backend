import { HttpException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';
import { Order, type OrderStatus } from './entities/order.entity';
import { OrdersService } from './orders.service';

// OrdersService uses @InjectRepository (from @nestjs/typeorm, ESM, which this Jest setup can't parse);
// the decorator is only DI metadata, so a no-op stands in and the test passes a real repository.
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
jest.mock('../mail/mail.service', () => ({
  MailService: class MailService {},
}));
jest.mock('../users/users.service', () => ({
  UsersService: class UsersService {},
}));

/** GET /orders/mine and GET /orders/:id against a real Postgres (own database, migrations applied). */
const url = process.env.TEST_DATABASE_URL;
const isLocal = !!url && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
const suite = url && isLocal ? describe : describe.skip;

suite('OrdersService reads (real Postgres)', () => {
  const dbName = `ido_reads_${Date.now()}`;
  let admin: DataSource;
  let ds: DataSource;
  let svc: OrdersService;
  let userA: string;
  let userB: string;
  let seq = 0;

  async function insertOrder(
    userId: string,
    status: OrderStatus,
    hoursAgo: number,
  ) {
    const id = `IDO-TEST${String(++seq).padStart(6, '0')}`;
    await ds.query(
      `INSERT INTO "orders" ("id", "user_id", "idempotency_key", "status", "cancel_reason", "payment_method", "finish",
         "unit_price", "list_price", "subtotal", "cod_fee", "discount", "total", "kit_price_snapshot",
         "customer", "address", "created_at")
       VALUES ($1, $2, gen_random_uuid(), $3, $4, 'online', 'gold', 1499900, 1999900, 1499900, 0, 0, 1499900, 99900,
         '{"name":"Ananya Sharma","email":"ananya@example.com","phone":"9800000001"}',
         '{"line":"12 MG Road","city":"Pune","state":"Maharashtra","pin":"411001"}',
         now() - make_interval(hours => $5))`,
      [id, userId, status, status === 'cancelled' ? 'unpaid' : null, hoursAgo],
    );
    return id;
  }

  beforeAll(async () => {
    admin = new DataSource({ type: 'postgres', url });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    ds = new DataSource({
      type: 'postgres',
      url: url!.replace(/\/[^/]+$/, `/${dbName}`),
      entities: ENTITIES,
      migrations: [__dirname + '/../migrations/*.ts'],
    });
    await ds.initialize();
    await ds.runMigrations();
    [{ id: userA }] = await ds.query(
      `INSERT INTO "users" ("phone") VALUES ('9800000001') RETURNING "id"`,
    );
    [{ id: userB }] = await ds.query(
      `INSERT INTO "users" ("phone") VALUES ('9800000002') RETURNING "id"`,
    );
    svc = new OrdersService(ds.getRepository(Order), {} as never, {} as never);
  }, 180_000);

  afterAll(async () => {
    await ds?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin?.destroy();
  });

  describe('findMineForUser (GET /orders/mine)', () => {
    let confirmed: string;
    let codPending: string;
    let cancelled: string;

    beforeAll(async () => {
      cancelled = await insertOrder(userA, 'cancelled', 72); // oldest
      await insertOrder(userA, 'pending_payment', 48); // abandoned checkout: never listed
      confirmed = await insertOrder(userA, 'confirmed', 24);
      codPending = await insertOrder(userA, 'cod_pending', 1); // newest
      await insertOrder(userB, 'confirmed', 2); // someone else's
    });

    it('lists my orders newest first and never a pending_payment order', async () => {
      const mine = await svc.findMineForUser(userA);
      expect(mine.map((o) => [o.id, o.status])).toEqual([
        [codPending, 'cod_pending'],
        [confirmed, 'confirmed'],
        [cancelled, 'cancelled'],
      ]);
    });

    it('returns the contract Order shape (no internal columns)', async () => {
      const [o] = await svc.findMineForUser(userA);
      expect(o).toEqual(
        expect.objectContaining({
          shipments: [],
          refund: null,
          invoice: null,
          creditNotes: [],
          consultWindow: null,
          total: 1499900,
          customer: expect.objectContaining({ name: 'Ananya Sharma' }),
        }),
      );
      for (const internal of [
        'idempotencyKey',
        'userId',
        'stockReserved',
        'codCallAttempts',
        'piiScrubbedAt',
      ]) {
        expect(o).not.toHaveProperty(internal);
      }
    });

    it('a customer with no orders gets an empty list', async () => {
      const [{ id: userC }] = await ds.query(
        `INSERT INTO "users" ("phone") VALUES ('9800000003') RETURNING "id"`,
      );
      expect(await svc.findMineForUser(userC)).toEqual([]);
    });
  });

  describe('findOneForUser (GET /orders/:id)', () => {
    it('the owner gets the order, including while pending_payment (/confirm polls it)', async () => {
      const id = await insertOrder(userA, 'pending_payment', 0);
      expect(await svc.findOneForUser(id, userA)).toEqual(
        expect.objectContaining({ id, status: 'pending_payment' }),
      );
    });

    it("someone else's order is a 404, the same as a missing one", async () => {
      const id = await insertOrder(userA, 'confirmed', 0);
      for (const call of [
        svc.findOneForUser(id, userB),
        svc.findOneForUser('IDO-NOPE000000', userA),
      ]) {
        await expect(call).rejects.toBeInstanceOf(HttpException);
        await expect(call).rejects.toMatchObject({ status: 404 });
      }
    });
  });
});
