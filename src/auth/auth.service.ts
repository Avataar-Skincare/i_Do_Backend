import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { UsersService } from '../users/users.service';
import { OrdersService } from '../orders/orders.service';
import { ConsultsService } from '../consults/consults.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { SendPhoneOtpDto } from './dto/send-phone-otp.dto';
import { VerifyPhoneOtpDto } from './dto/verify-phone-otp.dto';
import { SendEmailOtpDto } from './dto/send-email-otp.dto';
import { VerifyEmailOtpDto } from './dto/verify-email-otp.dto';
import { OtpInvalidException, OtpRateLimitException } from './otp-errors';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { EmailVerificationCode } from './entities/email-verification-code.entity';
import { PhoneOtp } from './entities/phone-otp.entity';
import { EmailOtp } from './entities/email-otp.entity';
import { RefreshToken, type TokenClient } from './entities/refresh-token.entity';
import { Fast2SmsService } from '../sms/fast2sms.service';
import { WhatsappService } from '../sms/whatsapp.service';
import type { User } from '../users/entities/user.entity';

const SALT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const PHONE_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const EMAIL_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
/** Same limits as the phone OTP in the API contract: 1 per 30 s and 5 per hour per address, N per hour per IP. */
const OTP_RESEND_GAP_MS = 30 * 1000;
const OTP_PER_ADDRESS_PER_HOUR = 5;
const OTP_MAX_WRONG_ATTEMPTS = 5;
const HOUR_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days for web and app (ops sessions are 12 h, added with the staff login)
const ACCESS_TTL_FALLBACK_MS = 15 * 60 * 1000;

/** Who is logging in and from where: stored on the refresh token for audit. */
export type SessionContext = { client: TokenClient; ip?: string; userAgent?: string };
/** `accessToken` + `refreshToken` go in cookies for the website and in the body for the app. */
export type Session = { accessToken: string; refreshToken: string; accessTokenExpiresAt: Date };
export type SessionResult = { user: PublicUser; session: Session };
/** Same response whether or not the account is registered — never confirms/denies one exists. */
const FORGOT_PASSWORD_RESPONSE = { message: "If an account exists for that email, we've sent a reset link." };

export type PublicUser = Pick<
  User,
  'id' | 'email' | 'phone' | 'fullName' | 'role' | 'createdAt' | 'emailVerifiedAt' | 'phoneVerifiedAt'
>;

function toPublicUser(user: User): PublicUser {
  const { id, email, phone, fullName, role, createdAt, emailVerifiedAt, phoneVerifiedAt } = user;
  return { id, email, phone, fullName, role, createdAt, emailVerifiedAt, phoneVerifiedAt };
}

function generateOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly ordersService: OrdersService,
    private readonly consultsService: ConsultsService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokensRepo: Repository<PasswordResetToken>,
    @InjectRepository(EmailVerificationCode)
    private readonly verificationCodesRepo: Repository<EmailVerificationCode>,
    @InjectRepository(PhoneOtp)
    private readonly phoneOtpRepo: Repository<PhoneOtp>,
    @InjectRepository(EmailOtp)
    private readonly emailOtpRepo: Repository<EmailOtp>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokensRepo: Repository<RefreshToken>,
    private readonly fast2SmsService: Fast2SmsService,
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * Email only — phone signup/login goes through sendPhoneOtp/verifyPhoneOtp
   * instead (passwordless, same account either way). Sends a 6-digit code
   * and holds the session until it's verified (see AuthController.verifyEmail)
   * — catches a typo'd/fake address before order and consult confirmations
   * go nowhere.
   */
  async register(dto: RegisterDto): Promise<{ user: PublicUser; token: string }> {
    if (await this.usersService.findByEmail(dto.email)) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
    });

    await this.sendVerificationCode(user).catch((err) =>
      this.logger.warn(`Signup verification email failed for ${user.email}: ${(err as Error).message}`),
    );

    return { user: toPublicUser(user), token: this.signToken(user) };
  }

  async login(dto: LoginDto): Promise<{ user: PublicUser; token: string }> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return { user: toPublicUser(user), token: this.signToken(user) };
  }

  /** Invalidates any outstanding code for this phone before sending a fresh one — works for both a new and an existing phone. */
  async sendPhoneOtp(dto: SendPhoneOtpDto): Promise<{ message: string }> {
    await this.phoneOtpRepo.update({ phone: dto.phone, usedAt: IsNull() }, { usedAt: new Date() });

    const code = generateOtp();
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    await this.phoneOtpRepo.save(
      this.phoneOtpRepo.create({
        phone: dto.phone,
        codeHash,
        expiresAt: new Date(Date.now() + PHONE_OTP_TTL_MS),
      }),
    );

    await this.fast2SmsService.sendOtp(dto.phone, code);
    await this.whatsappService.sendOtp(dto.phone, code);

    return { message: 'A verification code has been sent to your phone.' };
  }

  /**
   * One call does double duty, same as the Client repo's own flow: if this
   * phone has no account yet, verifying the code creates one (no password —
   * phone accounts are passwordless, every login is a fresh OTP); if it
   * already exists, verifying just logs them in.
   */
  async verifyPhoneOtp(dto: VerifyPhoneOtpDto, ctx: SessionContext): Promise<SessionResult> {
    const codeHash = crypto.createHash('sha256').update(dto.code).digest('hex');
    const verification = await this.phoneOtpRepo.findOne({
      where: { phone: dto.phone, codeHash },
      order: { createdAt: 'DESC' },
    });

    if (!verification || verification.usedAt || verification.expiresAt < new Date()) {
      throw new UnauthorizedException('That code is invalid or has expired');
    }

    verification.usedAt = new Date();
    await this.phoneOtpRepo.save(verification);

    let user = await this.usersService.findByPhone(dto.phone);
    if (!user) {
      user = await this.usersService.create({ phone: dto.phone, fullName: dto.fullName });
    }
    if (!user.phoneVerifiedAt) {
      await this.usersService.markPhoneVerified(user.id);
      user.phoneVerifiedAt = new Date();
    }

    return { user: toPublicUser(user), session: await this.issueSession(user, ctx) };
  }

  /**
   * Passwordless email login. Works the same for a new and an existing address (the first
   * successful verify creates the account), and never says whether an account exists.
   * Any code still outstanding for this address is invalidated before a fresh one is sent.
   */
  async sendEmailOtp(dto: SendEmailOtpDto, ip?: string): Promise<{ message: string }> {
    await this.enforceEmailOtpLimits(dto.email, ip);
    await this.emailOtpRepo.update({ email: dto.email, usedAt: IsNull() }, { usedAt: new Date() });

    const code = generateOtp();
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    await this.emailOtpRepo.save(
      this.emailOtpRepo.create({
        email: dto.email,
        codeHash,
        expiresAt: new Date(Date.now() + EMAIL_OTP_TTL_MS),
        ip: ip ?? null,
      }),
    );

    await this.mailService.sendEmail({
      to: dto.email,
      subject: `${code} is your i do login code`,
      html: `
        <p>Hi,</p>
        <p>Your i do login code is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">${code}</p>
        <p>This code expires in 10 minutes. If you didn't try to log in to i do, you can ignore this email.</p>
      `,
    });

    return { message: 'A verification code has been sent to your email.' };
  }

  /**
   * One call does double duty, like the phone flow: an address with no account gets one created
   * (no password, every login is a fresh code); an existing account is just logged in. Five wrong
   * guesses burn the code.
   */
  async verifyEmailOtp(dto: VerifyEmailOtpDto, ctx: SessionContext): Promise<SessionResult> {
    const otp = await this.emailOtpRepo.findOne({
      where: { email: dto.email, usedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (!otp || otp.expiresAt < new Date() || otp.attempts >= OTP_MAX_WRONG_ATTEMPTS) throw new OtpInvalidException();

    const given = crypto.createHash('sha256').update(dto.code).digest();
    const stored = Buffer.from(otp.codeHash, 'hex');
    if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) {
      const attempts = otp.attempts + 1;
      await this.emailOtpRepo.update(
        { id: otp.id },
        { attempts, ...(attempts >= OTP_MAX_WRONG_ATTEMPTS ? { usedAt: new Date() } : {}) },
      );
      throw new OtpInvalidException();
    }

    // Conditional update: if two requests race with the right code, only one gets to use it.
    const claimed = await this.emailOtpRepo.update({ id: otp.id, usedAt: IsNull() }, { usedAt: new Date() });
    if (!claimed.affected) throw new OtpInvalidException();

    let user = await this.usersService.findByEmailInsensitive(dto.email);
    if (!user) user = await this.usersService.create({ email: dto.email, fullName: dto.fullName });
    if (!user.emailVerifiedAt) {
      await this.usersService.markEmailVerified(user.id);
      user.emailVerifiedAt = new Date();
    }

    return { user: toPublicUser(user), session: await this.issueSession(user, ctx) };
  }

  /**
   * Rotation: a valid, not-yet-rotated refresh token is consumed and exchanged for a brand-new pair
   * in the same family. If a token that was already rotated is presented again, someone copied it
   * after the real owner moved on: the whole family is revoked (reason 'reuse') and everyone on it
   * must log in again.
   */
  async refreshSession(rawRefreshToken: string, ctx: SessionContext): Promise<SessionResult> {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const existing = await this.refreshTokensRepo.findOne({ where: { tokenHash } });
    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) throw this.sessionExpired();

    if (existing.rotatedAt) {
      await this.refreshTokensRepo.update(
        { familyId: existing.familyId, revokedAt: IsNull() },
        { revokedAt: new Date(), revokedReason: 'reuse' },
      );
      this.logger.warn(`Reused refresh token for user ${existing.userId}: family ${existing.familyId} revoked`);
      throw this.sessionExpired();
    }

    const user = await this.usersService.findById(existing.userId);
    if (!user) throw this.sessionExpired();

    // Conditional update: if two requests present the same token at once, only one rotates it.
    const claimed = await this.refreshTokensRepo.update(
      { id: existing.id, rotatedAt: IsNull() },
      { rotatedAt: new Date() },
    );
    if (!claimed.affected) throw this.sessionExpired();

    return {
      user: toPublicUser(user),
      session: await this.issueSession(user, { ...ctx, client: existing.client }, existing),
    };
  }

  /** Revokes the whole family so a stolen refresh token can't outlive the logout meant to end it. */
  async logoutSession(rawRefreshToken: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const existing = await this.refreshTokensRepo.findOne({ where: { tokenHash } });
    if (!existing) return;
    await this.refreshTokensRepo.update(
      { familyId: existing.familyId, revokedAt: IsNull() },
      { revokedAt: new Date(), revokedReason: 'logout' },
    );
  }

  private sessionExpired(): UnauthorizedException {
    return new UnauthorizedException({
      statusCode: HttpStatus.UNAUTHORIZED,
      message: 'Your session has expired. Please log in again.',
      code: 'UNAUTHORIZED',
    });
  }

  /**
   * An access token and a separate refresh token, issued together. A fresh login starts a new
   * family; a rotation continues the parent's family. Only the sha256 of the refresh token is stored.
   */
  private async issueSession(user: User, ctx: SessionContext, parent?: RefreshToken): Promise<Session> {
    const refreshToken = crypto.randomBytes(32).toString('hex');
    await this.refreshTokensRepo.save(
      this.refreshTokensRepo.create({
        userId: user.id,
        familyId: parent?.familyId ?? crypto.randomUUID(),
        parentId: parent?.id ?? null,
        tokenHash: crypto.createHash('sha256').update(refreshToken).digest('hex'),
        client: ctx.client,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      }),
    );

    const accessToken = this.signToken(user);
    const exp = (this.jwtService.decode(accessToken) as { exp?: number } | null)?.exp;
    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: new Date(exp ? exp * 1000 : Date.now() + ACCESS_TTL_FALLBACK_MS),
    };
  }

  private async enforceEmailOtpLimits(email: string, ip?: string): Promise<void> {
    const now = Date.now();
    const sinceHour = new Date(now - HOUR_MS);
    const recent = await this.emailOtpRepo.find({
      where: { email, createdAt: MoreThan(sinceHour) },
      order: { createdAt: 'DESC' },
    });

    if (recent.length > 0) {
      const wait = OTP_RESEND_GAP_MS - (now - recent[0].createdAt.getTime());
      if (wait > 0) {
        const seconds = Math.ceil(wait / 1000);
        throw new OtpRateLimitException(`Please wait ${seconds} seconds before asking for another code.`, seconds);
      }
    }
    if (recent.length >= OTP_PER_ADDRESS_PER_HOUR) {
      const seconds = Math.max(1, Math.ceil((recent[recent.length - 1].createdAt.getTime() + HOUR_MS - now) / 1000));
      throw new OtpRateLimitException('Too many codes requested. Please try again later.', seconds);
    }

    const ipLimit = this.config.get<number>('OTP_IP_HOURLY_LIMIT', 20);
    if (ip && (await this.emailOtpRepo.count({ where: { ip, createdAt: MoreThan(sinceHour) } })) >= ipLimit) {
      throw new OtpRateLimitException('Too many codes requested. Please try again later.', 600);
    }
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException();
    return toPublicUser(user);
  }

  /**
   * Orders are kept for accounting/tax records but stripped of anything
   * identifying; consults are hard-deleted (no such requirement applies to
   * them). The account itself goes last, after both have succeeded.
   */
  async deleteAccount(userId: string): Promise<void> {
    await this.ordersService.anonymizeForUser(userId);
    await this.consultsService.deleteAllForUser(userId);
    await this.usersService.deleteById(userId);
  }

  /**
   * Always returns the same generic message, whether or not the email is
   * registered — otherwise this endpoint would let anyone probe which emails
   * have accounts. Only actually creates a token + sends mail when it finds one.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) return FORGOT_PASSWORD_RESPONSE;

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await this.resetTokensRepo.save(
      this.resetTokensRepo.create({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      }),
    );

    const frontendOrigin = this.config.get<string>('FRONTEND_ORIGIN', 'http://localhost:3000');
    const resetLink = `${frontendOrigin}/reset-password?token=${rawToken}`;

    // Guaranteed non-null — findByEmail only matches rows where email equals the given string.
    await this.mailService.sendEmail({
      to: user.email!,
      subject: 'Reset your i do password',
      html: `
        <p>Hi ${user.fullName ?? 'there'},</p>
        <p>Someone asked to reset the password on your i do account. If this was you, click below —
        this link expires in 1 hour:</p>
        <p><a href="${resetLink}">Reset your password</a></p>
        <p>If you didn't request this, you can safely ignore this email — your password won't change.</p>
      `,
    });

    return FORGOT_PASSWORD_RESPONSE;
  }

  /** The token is single-use and expires after an hour — checked against its hash, never the raw value. */
  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = crypto.createHash('sha256').update(dto.token).digest('hex');
    const resetToken = await this.resetTokensRepo.findOne({ where: { tokenHash } });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new UnauthorizedException('This reset link is invalid or has expired');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.usersService.updatePassword(resetToken.userId, passwordHash);

    resetToken.usedAt = new Date();
    await this.resetTokensRepo.save(resetToken);

    return { message: 'Your password has been reset — you can now log in.' };
  }

  /** Checked against the code's hash, never the raw value — same defense-in-depth as password reset tokens. */
  async verifyEmail(userId: string, dto: VerifyEmailDto): Promise<{ message: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException();
    if (!user.email) throw new BadRequestException('This account has no email to verify');
    if (user.emailVerifiedAt) return { message: 'Your email is already verified.' };

    const codeHash = crypto.createHash('sha256').update(dto.code).digest('hex');
    const verification = await this.verificationCodesRepo.findOne({
      where: { userId, codeHash },
      order: { createdAt: 'DESC' },
    });

    if (!verification || verification.usedAt || verification.expiresAt < new Date()) {
      throw new UnauthorizedException('That code is invalid or has expired');
    }

    verification.usedAt = new Date();
    await this.verificationCodesRepo.save(verification);
    await this.usersService.markEmailVerified(userId);

    return { message: 'Your email is verified.' };
  }

  /** Non-blocking, so a user can request a fresh code as many times as they need. */
  async resendVerificationEmail(userId: string): Promise<{ message: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException();
    if (!user.email) throw new BadRequestException('This account has no email to verify');
    if (user.emailVerifiedAt) return { message: 'Your email is already verified.' };

    await this.sendVerificationCode(user);
    return { message: 'A new verification code has been sent to your email.' };
  }

  /** Invalidates any codes still outstanding for this user before issuing a fresh one. */
  private async sendVerificationCode(user: User): Promise<void> {
    if (!user.email) return;

    await this.verificationCodesRepo.update({ userId: user.id, usedAt: IsNull() }, { usedAt: new Date() });

    const code = generateOtp();
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    await this.verificationCodesRepo.save(
      this.verificationCodesRepo.create({
        userId: user.id,
        codeHash,
        expiresAt: new Date(Date.now() + VERIFICATION_CODE_TTL_MS),
      }),
    );

    await this.mailService.sendEmail({
      to: user.email,
      subject: 'Verify your i do email',
      html: `
        <p>Hi ${user.fullName ?? 'there'},</p>
        <p>Your verification code is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">${code}</p>
        <p>This code expires in 15 minutes. If you didn't sign up for i do, you can ignore this email.</p>
      `,
    });
  }

  private signToken(user: User): string {
    // No email or phone inside: a JWT is only base64, anyone holding it can read the payload.
    return this.jwtService.sign({ sub: user.id, role: user.role });
  }
}
