import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** POST /orders/:id/payment/verify — Razorpay Checkout's handler response, as-is. */
export class PaymentVerifyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  razorpayOrderId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  razorpayPaymentId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  razorpaySignature: string;
}
