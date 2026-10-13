import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  /** Email only — phone signup now goes through /auth/phone/send-otp + /auth/phone/verify-otp instead. */
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;
}
