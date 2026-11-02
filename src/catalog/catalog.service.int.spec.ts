import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';
import { SettingsService } from '../settings/settings.service';
import { CatalogService } from './catalog.service';

/** CatalogService against the real seeded schema (M13 settings + 24 ring SKUs + kit). */
const url = process.env.TEST_DATABASE_URL;
const isLocal = !!url && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
const suite = url && isLocal ? describe : describe.skip;

suite('CatalogService (real Postgres)', () => {
  const dbName = `ido_catalog_${Date.now()}`;
  let admin: DataSource;
  let ds: DataSource;
  let svc: CatalogService;

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
    svc = new CatalogService(new SettingsService(ds), ds);
  }, 180_000);

  afterAll(async () => {
    await ds?.destroy();
    await admin?.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin?.destroy();
  });

  it('serves the seeded prices and all 3 finishes × 8 sizes, nothing in stock yet', async () => {
    const c = await svc.getCatalog();
    expect(c).toEqual(
      expect.objectContaining({
        pricePaise: 1499900,
        listPricePaise: 1999900,
        codFeePaise: 10000,
        codEnabled: true,
      }),
    );
    expect(c.finishes.map((f) => f.id)).toEqual(['gold', 'silver', 'black']);
    for (const f of c.finishes) {
      expect(f.sizes.map((s) => s.us)).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
      expect(f.sizes.every((s) => !s.inStock)).toBe(true);
    }
  });

  it('reflects stock: on hand minus reserved ≥ 1 is in stock', async () => {
    await ds.query(
      `UPDATE "skus" SET "on_hand" = 2, "reserved" = 1 WHERE "finish" = 'gold' AND "us_size" = 8`,
    );
    const gold = (await svc.getCatalog()).finishes.find(
      (f) => f.id === 'gold',
    )!;
    expect(gold.sizes.find((s) => s.us === 8)).toEqual({
      us: 8,
      inStock: true,
    });
  });

  it('quotes from the stored settings, and follows a settings change', async () => {
    expect(
      await svc.quote({ finish: 'gold', paymentMethod: 'cod', pin: '122001' }),
    ).toEqual(expect.objectContaining({ total: 1509900, codAvailable: true }));
    await ds.query(
      `UPDATE "settings" SET "value" = 'false'::jsonb WHERE "key" = 'cod_enabled'`,
    );
    expect(
      await svc.quote({ finish: 'gold', paymentMethod: 'cod', pin: '122001' }),
    ).toEqual(
      expect.objectContaining({
        total: 1499900,
        codAvailable: false,
        codReason: 'cod_disabled',
      }),
    );
  });
});
