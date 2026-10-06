import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { IsInt, Min } from 'class-validator';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

class CreateRazorpayOrderDto {
  /** Paise — the exact total the customer is about to pay, same unit as everywhere else here. */
  @IsInt()
  @Min(100)
  amount: number;
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * Called before Razorpay's checkout widget opens — creates the order on
   * Razorpay's side so the widget has something real to attach a payment to.
   * This does not create anything in our own `orders` table yet; that only
   * happens in `create()` below, once the payment is verified.
   */
  @UseGuards(JwtAuthGuard)
  @Post('razorpay-order')
  createRazorpayOrder(@Body() dto: CreateRazorpayOrderDto, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.ordersService.createRazorpayOrder(dto.amount, req.user.userId);
  }

  /** Requires an account — decided 2026-09-30, see CLAUDE.md. */
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateOrderDto, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.ordersService.create(dto, req.user.userId);
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
   * Single order by id — intentionally public (no auth), same as any
   * "order confirmation" link pattern: you need the exact id, which isn't
   * guessable or listable anywhere. Do NOT add a "list all orders" endpoint
   * without per-user scoping — see CLAUDE.md, this was a real data leak once.
   */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }
}
