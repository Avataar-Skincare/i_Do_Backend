import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';
import { RefundPendingDestinationConsultNote1792000000021 } from '../migrations/1792000000021-RefundPendingDestinationConsultNote';

/**
 * Migrations against a real Postgres. Uses TEST_DATABASE_URL only to connect
 * as admin; each run creates and drops its own database so it never collides
 * with other integration specs. Skipped without TEST_DATABASE_URL; refuses
 * non-local hosts.
 */
const url = process.env.TEST_DATABASE_URL;
const isLocal = !!url && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
const suite = url && isLocal ? describe : describe.skip;

suite('migrations (real Postgres)', () => {
  const dbName = `ido_mig_${Date.now()}`;
  let admin: DataSource;
  let ds: DataSource;

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
  }, 120_000);

  afterAll(async () => {
    await ds?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin?.destroy();
  });

  async function column(table: string, name: string) {
    const [c] = await ds.query(
      `SELECT "is_nullable", "data_type" FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, name],
    );
    return c as { is_nullable: string; data_type: string } | undefined;
  }

  describe('M21: refund destination can be pending; consult note', () => {
    it('refunds.method is nullable (COD refused-ring refund before the customer gives UPI/bank)', async () => {
      expect(await column('refunds', 'method')).toEqual({
        is_nullable: 'YES',
        data_type: 'character varying',
      });
    });

    it('refunds.method still only accepts known methods when set', async () => {
      const [chk] = await ds.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'CHK_refunds_method'`,
      );
      expect(chk.def).toMatch(/razorpay.*bank.*upi/);
    });

    it('consults.note exists as nullable text (partner completion / no-show note)', async () => {
      expect(await column('consults', 'note')).toEqual({
        is_nullable: 'YES',
        data_type: 'text',
      });
    });

    it('reverts cleanly: down() restores the previous shape', async () => {
      // Run M21's own down()/up(): later migrations (e.g. EmailOtps) mean it is no longer the last one.
      const m21 = new RefundPendingDestinationConsultNote1792000000021();
      const qr = ds.createQueryRunner();
      await m21.down(qr);
      expect(await column('refunds', 'method')).toEqual({
        is_nullable: 'NO',
        data_type: 'character varying',
      });
      expect(await column('consults', 'note')).toBeUndefined();
      await m21.up(qr);
      await qr.release();
      expect(await column('refunds', 'method')).toEqual(
        expect.objectContaining({ is_nullable: 'YES' }),
      );
    });
  });
});
