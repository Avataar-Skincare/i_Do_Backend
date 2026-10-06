import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Order } from './orders/entities/order.entity';
import { Consult } from './consults/entities/consult.entity';
import { User } from './users/entities/user.entity';
import { PasswordResetToken } from './auth/entities/password-reset-token.entity';
import { EmailVerificationCode } from './auth/entities/email-verification-code.entity';
import { OrderClaimToken } from './orders/entities/order-claim-token.entity';
import { NewsletterSubscriber } from './newsletter/entities/newsletter-subscriber.entity';

/**
 * For the TypeORM CLI only (migration:generate/run/revert) — the app itself
 * builds its connection via ConfigService in app.module.ts. Kept in sync
 * manually — entities list must match app.module.ts's.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'lume',
  entities: [Order, Consult, User, PasswordResetToken, EmailVerificationCode, OrderClaimToken, NewsletterSubscriber],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
