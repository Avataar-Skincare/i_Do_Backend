import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { isUUID } from 'class-validator';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderCreationService } from './create/order-creation.service';
import { PaymentVerifyDto } from './dto/payment-verify.dto';
import { PaymentVerifyService } from './payment/payment-verify.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { apiError } from '../common/api-error';

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderCreation: OrderCreationService,
    private readonly paymentVerify: PaymentVerifyService,
  ) {}

  /**
   * Requires an account — decided 2026-09-30, see CLAUDE.md. 201 for a new
   * order; 200 when the Idempotency-Key was already used with the same
   * details (the "Try payment again" retry); 409 IDEMPOTENCY_KEY_REUSED if
   * the details differ.
   */
  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!idempotencyKey || !isUUID(idempotencyKey)) {
      throw apiError(
        400,
        'VALIDATION_FAILED',
        'Idempotency-Key header must be a UUID',
      );
    }
    if (dto.buyerGstin !== undefined && !GSTIN.test(dto.buyerGstin)) {
      throw apiError(
        400,
        'GSTIN_INVALID',
        "That GST number doesn't look right.",
      );
    }
    if ((dto.buyerGstin === undefined) !== (dto.buyerLegalName === undefined)) {
      throw apiError(
        400,
        'VALIDATION_FAILED',
        'Send buyerGstin and buyerLegalName together, or neither',
      );
    }
    const result = await this.orderCreation.create(
      req.user.userId,
      idempotencyKey,
      dto,
    );
    res.status(result.created ? 201 : 200);
    return result.body;
  }

  /**
   * Razorpay Checkout's handler result. Returns the order: `confirmed` if
   * Razorpay has captured, else still `pending_payment` (keep polling
   * GET /orders/:id). 400 SIGNATURE_INVALID if it doesn't check out.
   */
  @UseGuards(JwtAuthGuard)
  @Post(':id/payment/verify')
  @HttpCode(200)
  verifyPayment(
    @Param('id') id: string,
    @Body() dto: PaymentVerifyDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.paymentVerify.verify(req.user.userId, id, dto);
  }

  // Must come before the ':id' route below — Nest matches routes in
  // declaration order, and ':id' would otherwise swallow "/orders/mine"
  // by treating "mine" as the id.
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  findMine(@Req() req: Request & { user: AuthenticatedUser }) {
    return this.ordersService.findMineForUser(req.user.userId);
  }

  /**
   * Owner only (contract v1.0): anyone else gets 404, as if the order didn't
   * exist. Includes pending_payment orders so /confirm can poll for payment.
   */
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.ordersService.findOneForUser(id, req.user.userId);
  }
}
