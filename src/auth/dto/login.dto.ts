import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  /** Either an email or a 10-digit phone number — AuthService.login checks both columns. */
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @IsString()
  password: string;
}
