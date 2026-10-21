import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService, type SessionContext, type SessionResult } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { SendPhoneOtpDto } from './dto/send-phone-otp.dto';
import { VerifyPhoneOtpDto } from './dto/verify-phone-otp.dto';
import { SendEmailOtpDto } from './dto/send-email-otp.dto';
import { VerifyEmailOtpDto } from './dto/verify-email-otp.dto';
import { OtpRateLimitException } from './otp-errors';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { clearAuthCookies, getRefreshCookie, setAuthCookies } from './cookies';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  /** The app (X-Client: app) has no cookies and gets its tokens in the body; the website gets cookies. */
  private context(req: Request): SessionContext {
    return {
      client: req.headers['x-client'] === 'app' ? 'app' : 'web',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }

  private respond(res: Response, ctx: SessionContext, { user, session }: SessionResult) {
    if (ctx.client === 'app') {
      return {
        user,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        accessTokenExpiresAt: session.accessTokenExpiresAt,
      };
    }
    setAuthCookies(res, this.config, session.accessToken, session.refreshToken);
    return { user };
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('phone/send-otp')
  sendPhoneOtp(@Body() dto: SendPhoneOtpDto) {
    return this.authService.sendPhoneOtp(dto);
  }

  @Post('phone/verify-otp')
  @HttpCode(200)
  async verifyPhoneOtp(@Body() dto: VerifyPhoneOtpDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ctx = this.context(req);
    return this.respond(res, ctx, await this.authService.verifyPhoneOtp(dto, ctx));
  }

  @Post('email/send-otp')
  async sendEmailOtp(@Body() dto: SendEmailOtpDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return await this.authService.sendEmailOtp(dto, req.ip);
    } catch (err) {
      if (err instanceof OtpRateLimitException) res.setHeader('Retry-After', String(err.retryAfterSeconds));
      throw err;
    }
  }

  @Post('email/verify-otp')
  @HttpCode(200)
  async verifyEmailOtp(@Body() dto: VerifyEmailOtpDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ctx = this.context(req);
    return this.respond(res, ctx, await this.authService.verifyEmailOtp(dto, ctx));
  }

  /** Website: the ido_rt cookie (Path=/auth) arrives by itself. App: the token in the body. */
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ctx = this.context(req);
    const raw = getRefreshCookie(req) ?? dto.refreshToken;
    if (!raw) throw new BadRequestException('Missing refresh token.');
    return this.respond(res, ctx, await this.authService.refreshSession(raw, ctx));
  }

  /** Always 204, even without a session. */
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshTokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = getRefreshCookie(req) ?? dto.refreshToken;
    if (raw) await this.authService.logoutSession(raw);
    clearAuthCookies(res, this.config);
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: Request & { user: AuthenticatedUser }) {
    return this.authService.me(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('verify-email')
  verifyEmail(@Req() req: Request & { user: AuthenticatedUser }, @Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('resend-verification')
  resendVerification(@Req() req: Request & { user: AuthenticatedUser }) {
    return this.authService.resendVerificationEmail(req.user.userId);
  }

  /** Irreversible — anonymizes past orders, hard-deletes consults, then the account itself. */
  @UseGuards(JwtAuthGuard)
  @Delete('me')
  async deleteMe(@Req() req: Request & { user: AuthenticatedUser }, @Res({ passthrough: true }) res: Response) {
    await this.authService.deleteAccount(req.user.userId);
    clearAuthCookies(res, this.config);
    return { deleted: true };
  }
}
