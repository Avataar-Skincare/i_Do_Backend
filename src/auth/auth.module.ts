import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { OrdersModule } from '../orders/orders.module';
import { ConsultsModule } from '../consults/consults.module';
import { MailModule } from '../mail/mail.module';
import { SmsModule } from '../sms/sms.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { EmailVerificationCode } from './entities/email-verification-code.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { getAuthPrivateKey, getAuthPublicKey } from './jwt-keys';
import { PhoneOtp } from './entities/phone-otp.entity';
import { EmailOtp } from './entities/email-otp.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([PasswordResetToken, EmailVerificationCode, PhoneOtp, EmailOtp, RefreshToken]),
    UsersModule,
    OrdersModule,
    ConsultsModule,
    MailModule,
    SmsModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // ES256 access tokens (LLD §9): only this service holds the private key; anyone with the
        // public key (the ring app's API) can verify. There is deliberately no shared-secret fallback.
        const privateKey = getAuthPrivateKey(config);
        const publicKey = getAuthPublicKey(config);
        if (!privateKey || !publicKey) {
          throw new Error('AUTH_PRIVATE_KEY and AUTH_PUBLIC_KEY must be set (PEM, \\n-escaped on one line).');
        }
        return {
          privateKey,
          publicKey,
          signOptions: {
            algorithm: 'ES256' as const,
            // @nestjs/jwt's type wants a branded `StringValue` from `ms`, not `string`.
            expiresIn: config.get<string>('JWT_EXPIRES_IN', '15m') as never,
            issuer: config.get<string>('JWT_ISSUER', 'https://api.idowellness.ai'),
            audience: config.get<string>('JWT_AUDIENCE', 'ido'),
            keyid: config.get<string>('JWT_KEY_ID', 'prod-2026-10'),
          },
          verifyOptions: { algorithms: ['ES256' as const] },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
