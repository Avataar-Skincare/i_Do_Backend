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
  entities: ENTITIES,
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
