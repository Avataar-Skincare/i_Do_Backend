import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { OrdersModule } from '../orders/orders.module';
import { ConsultsModule } from '../consults/consults.module';
import { MailModule } from '../mail/mail.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { EmailVerificationCode } from './entities/email-verification-code.entity';
import { OrderClaimToken } from '../orders/entities/order-claim-token.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([PasswordResetToken, EmailVerificationCode, OrderClaimToken]),
    UsersModule,
    OrdersModule,
    ConsultsModule,
    MailModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'dev-only-change-me'),
        // @nestjs/jwt's type wants a branded `StringValue` from `ms`, not `string`
        // — the runtime value is fine (it's `ms`'s own default), so cast past it.
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d') as never },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
