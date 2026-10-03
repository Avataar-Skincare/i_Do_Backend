import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  /** Either an email or a 10-digit phone number — AuthService.register detects which (see isPhone there). */
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;
}
