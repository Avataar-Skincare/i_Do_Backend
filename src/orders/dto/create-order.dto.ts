import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { Finish } from '../../catalog/entities/sku.entity';
import type { PaymentMethod } from '../entities/order.entity';

/**
 * POST /orders body (api/openapi.yaml → CreateOrderRequest). No prices: the
 * server quotes them. GSTIN format and the GSTIN + legal-name pairing are
 * checked in the controller so they answer with the contract's own codes.
 */
class CustomerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsEmail()
  email: string;

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

  @Matches(/^\d{6}$/, { message: 'pin must be exactly 6 digits' })
  pin: string;
}

export class CreateOrderDto {
  @IsIn(['gold', 'silver', 'black'])
  finish: Finish;

  @IsIn(['online', 'cod'])
  paymentMethod: PaymentMethod;

  @ValidateNested()
  @Type(() => CustomerDto)
  customer: CustomerDto;

  @ValidateNested()
  @Type(() => AddressDto)
  address: AddressDto;

  @IsOptional()
  @IsString()
  buyerGstin?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  buyerLegalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  offerCode?: string;
}
