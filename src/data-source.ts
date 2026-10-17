import 'dotenv/config';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';

/**
 * For the TypeORM CLI only (migration:generate/run/revert) — the app itself
 * builds its connection via ConfigService in app.module.ts. Both share
 * the ENTITIES list in src/entities.ts.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'lume',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: ENTITIES,
  // __dirname-relative so the same file works under ts-node (src/*.ts) and in the
  // compiled image (dist/*.js), where src/ doesn't exist.
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});
