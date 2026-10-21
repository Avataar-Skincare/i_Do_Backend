import { IsOptional, IsString } from 'class-validator';

/** Optional — the website sends it as the `ido_rt` cookie instead; a future native app (no cookies) would send it here. */
export class RefreshTokenDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
