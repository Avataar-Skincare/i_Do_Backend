import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health/health.controller';
import { OrdersModule } from './orders/orders.module';
import { ConsultsModule } from './consults/consults.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { ContactModule } from './contact/contact.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { Order } from './orders/entities/order.entity';
import { Consult } from './consults/entities/consult.entity';
import { User } from './users/entities/user.entity';
import { PasswordResetToken } from './auth/entities/password-reset-token.entity';
import { EmailVerificationCode } from './auth/entities/email-verification-code.entity';
import { OrderClaimToken } from './orders/entities/order-claim-token.entity';
import { NewsletterSubscriber } from './newsletter/entities/newsletter-subscriber.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USER', 'postgres'),
        password: config.get<string>('DB_PASSWORD', 'postgres'),
        database: config.get<string>('DB_NAME', 'lume'),
        // `User` maps to a table this service doesn't own (see its entity
        // comment) — never let synchronize touch it. `Order`/`Consult` are
        // ours, managed by src/migrations/ instead of synchronize either way.
        entities: [Order, Consult, User, PasswordResetToken, EmailVerificationCode, OrderClaimToken, NewsletterSubscriber],
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        synchronize: config.get<string>('DB_SYNC', 'false') === 'true',
      }),
    }),
    OrdersModule,
    ConsultsModule,
    UsersModule,
    AuthModule,
    MailModule,
    ContactModule,
    NewsletterModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
