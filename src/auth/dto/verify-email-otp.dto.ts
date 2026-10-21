import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class VerifyEmailOtpDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email: string;

  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code: string;

  /** Only used if this email has no account yet; ignored for an existing account. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;
}
