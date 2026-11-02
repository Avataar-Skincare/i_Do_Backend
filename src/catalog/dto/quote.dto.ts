import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import type { Finish } from '../entities/sku.entity';
import type { PaymentMethod } from '../../orders/entities/order.entity';

/** POST /orders/quote (api/openapi.yaml → QuoteRequest). No prices: the server computes them. */
export class QuoteDto {
  @IsIn(['gold', 'silver', 'black'])
  finish: Finish;

  @IsIn(['online', 'cod'])
  paymentMethod: PaymentMethod;

  @Matches(/^\d{6}$/, { message: 'pin must be a 6-digit Indian pincode' })
  pin: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  offerCode?: string;
}
