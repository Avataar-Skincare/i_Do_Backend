import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ClaimOrderDto } from './dto/claim-order.dto';
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

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('claim-order/:token')
  getClaimOrderInfo(@Param('token') token: string) {
    return this.authService.getOrderClaimInfo(token);
  }

  @Post('claim-order')
  claimOrder(@Body() dto: ClaimOrderDto) {
    return this.authService.claimOrder(dto);
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
