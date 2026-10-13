import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class VerifyPhoneOtpDto {
  @Matches(/^\d{10}$/, { message: 'Enter a valid 10-digit phone number' })
  phone: string;

  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code: string;

  /** Only used if this phone has no account yet — ignored for an existing account. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;
}
