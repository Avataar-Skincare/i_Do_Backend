import { Body, Controller, Delete, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
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
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
  verifyPhoneOtp(@Body() dto: VerifyPhoneOtpDto) {
    return this.authService.verifyPhoneOtp(dto);
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
  verifyEmailOtp(@Body() dto: VerifyEmailOtpDto) {
    return this.authService.verifyEmailOtp(dto);
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
  async deleteMe(@Req() req: Request & { user: AuthenticatedUser }) {
    await this.authService.deleteAccount(req.user.userId);
    return { deleted: true };
  }
}
