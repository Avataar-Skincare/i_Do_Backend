import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  /** Email only — phone accounts log in via /auth/phone/send-otp + /auth/phone/verify-otp instead. */
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
