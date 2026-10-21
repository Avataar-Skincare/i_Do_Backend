import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

export class SendEmailOtpDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email: string;
}
