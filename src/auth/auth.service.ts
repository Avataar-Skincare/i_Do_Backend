import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
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
import { ClaimOrderDto } from './dto/claim-order.dto';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { EmailVerificationCode } from './entities/email-verification-code.entity';
import { OrderClaimToken } from '../orders/entities/order-claim-token.entity';
import type { User } from '../users/entities/user.entity';

const SALT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
/** Same response whether or not the account is registered — never confirms/denies one exists. */
const FORGOT_PASSWORD_RESPONSE = { message: "If an account exists for that email, we've sent a reset link." };
/** A 10-digit input is treated as a phone number — everything else as an email (same convention as login). */
const PHONE_RE = /^\d{10}$/;
const EMAIL_RE = /^\S+@\S+\.\S+$/;

export type PublicUser = Pick<User, 'id' | 'email' | 'phone' | 'fullName' | 'role' | 'createdAt' | 'emailVerifiedAt'>;

function toPublicUser(user: User): PublicUser {
  const { id, email, phone, fullName, role, createdAt, emailVerifiedAt } = user;
  return { id, email, phone, fullName, role, createdAt, emailVerifiedAt };
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
    @InjectRepository(OrderClaimToken)
    private readonly claimTokensRepo: Repository<OrderClaimToken>,
  ) {}

  /**
   * One field, one identifier — the customer picks email OR phone, never
   * both (a second mandatory field just to sign up is friction nobody asked
   * for). Signing up with a phone logs in immediately, no verification,
   * since there's no SMS/WhatsApp OTP provider wired up yet. Signing up with
   * an email sends a 6-digit code and holds the session until it's verified
   * (see AuthController.verifyEmail) — unlike phone, email delivery is
   * already proven (AWS SES), so there's no reason to skip it, and it catches
   * a typo'd/fake address before order and consult confirmations go nowhere.
   */
  async register(dto: RegisterDto): Promise<{ user: PublicUser; token: string }> {
    const isPhone = PHONE_RE.test(dto.identifier);
    if (!isPhone && !EMAIL_RE.test(dto.identifier)) {
      throw new BadRequestException('Enter a valid email or a 10-digit phone number');
    }

    if (isPhone) {
      if (await this.usersService.findByPhone(dto.identifier)) {
        throw new ConflictException('An account with this phone number already exists');
      }
    } else if (await this.usersService.findByEmail(dto.identifier)) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.usersService.create({
      email: isPhone ? undefined : dto.identifier,
      phone: isPhone ? dto.identifier : undefined,
      passwordHash,
      fullName: dto.fullName,
    });

    if (!isPhone) {
      await this.sendVerificationCode(user).catch((err) =>
        this.logger.warn(`Signup verification email failed for ${user.email}: ${(err as Error).message}`),
      );
    }

    return { user: toPublicUser(user), token: this.signToken(user) };
  }

  /** `identifier` can be either the account's email or its phone number. */
  async login(dto: LoginDto): Promise<{ user: PublicUser; token: string }> {
    const user = await this.usersService.findByIdentifier(dto.identifier);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return { user: toPublicUser(user), token: this.signToken(user) };
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

  /** Read-only — lets the frontend show "set a password" vs "log in" before the customer commits to anything. */
  async getOrderClaimInfo(rawToken: string): Promise<{ orderId: string; email: string; hasAccount: boolean }> {
    const claim = await this.findValidClaim(rawToken);
    const existing = await this.usersService.findByEmail(claim.email);
    return { orderId: claim.orderId, email: claim.email, hasAccount: !!existing };
  }

  /**
   * The link itself is the proof of inbox ownership (same trust model as
   * password reset) — no separate OTP needed. Creates the account if this
   * email has none yet (password required), otherwise just attaches to the
   * existing one and logs them in. Either way, every guest order under this
   * email gets attached, not just the one the link was sent for.
   */
  async claimOrder(dto: ClaimOrderDto): Promise<{ user: PublicUser; token: string }> {
    const claim = await this.findValidClaim(dto.token);

    let user = await this.usersService.findByEmail(claim.email);
    if (!user) {
      if (!dto.password) {
        throw new BadRequestException('Choose a password to create your account');
      }
      const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
      user = await this.usersService.create({ email: claim.email, passwordHash, fullName: dto.fullName });
    }

    if (!user.emailVerifiedAt) {
      await this.usersService.markEmailVerified(user.id);
      user.emailVerifiedAt = new Date();
    }

    await this.ordersService.attachAllGuestOrdersForEmail(user.id, claim.email);

    claim.usedAt = new Date();
    await this.claimTokensRepo.save(claim);

    return { user: toPublicUser(user), token: this.signToken(user) };
  }

  private async findValidClaim(rawToken: string): Promise<OrderClaimToken> {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const claim = await this.claimTokensRepo.findOne({ where: { tokenHash } });

    if (!claim || claim.usedAt || claim.expiresAt < new Date()) {
      throw new UnauthorizedException('This link is invalid or has expired');
    }

    return claim;
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
    await this.ordersService.attachAllGuestOrdersForEmail(userId, user.email);

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
    return this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });
  }
}
