import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `password`/`fullName` only apply when the claim creates a brand-new account —
 * if the email already has one, they're ignored (validated in AuthService, not
 * here, since which branch applies depends on a DB lookup, not the payload shape).
 */
export class ClaimOrderDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;
}
