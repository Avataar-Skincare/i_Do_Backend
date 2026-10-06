import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import type { OrderCartItem, PaymentMethod } from '../entities/order.entity';

class CartItemDto implements OrderCartItem {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  finish: string;

  @IsString()
  size: string;

  @IsInt()
  @Min(0)
  price: number;

  @IsInt()
  @Min(1)
  qty: number;

  @IsString()
  image: string;
}

class CustomerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  /** Matches the prototype's validation rule: exactly 10 digits. */
  @Matches(/^\d{10}$/, { message: 'phone must be exactly 10 digits' })
  phone: string;
}

class AddressDto {
  @IsString()
  @IsNotEmpty()
  line: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  state: string;

  /** Matches the prototype's validation rule: exactly 6 digits. */
  @Matches(/^\d{6}$/, { message: 'pin must be exactly 6 digits' })
  pin: string;
}

export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items: CartItemDto[];

  @IsInt()
  @Min(0)
  subtotal: number;

  @IsInt()
  @Min(0)
  codFee: number;

  @IsInt()
  @Min(0)
  total: number;

  @IsIn(['online', 'cod'])
  paymentMethod: PaymentMethod;

  @ValidateNested()
  @Type(() => CustomerDto)
  customer: CustomerDto;

  @ValidateNested()
  @Type(() => AddressDto)
  address: AddressDto;

  /**
   * Required when paymentMethod is 'online', absent for 'cod' — validated in
   * OrdersService.create (conditional on another field isn't expressible
   * cleanly with class-validator decorators alone). The signature is the
   * actual proof; the other two are just so the backend knows which
   * Razorpay order/payment to check it against.
   */
  @IsOptional()
  @IsString()
  razorpayOrderId?: string;

  @IsOptional()
  @IsString()
  razorpayPaymentId?: string;

  @IsOptional()
  @IsString()
  razorpaySignature?: string;
}
