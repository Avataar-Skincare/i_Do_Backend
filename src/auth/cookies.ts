import type { CookieOptions, Response } from 'express';
import { ConfigService } from '@nestjs/config';

const ACCESS_COOKIE = 'ido_at';
const REFRESH_COOKIE = 'ido_rt';
const ACCESS_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes — matches the access token's own expiry
const REFRESH_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

/**
 * Host-only (no `domain` set) — the browser only ever sends these back to
 * exactly the host that set them, never a parent or sibling domain.
 * HttpOnly: JavaScript on the page can never read them, so an injected
 * script can't steal a login this way (unlike the old `localStorage` token).
 */
function baseOptions(config: ConfigService): CookieOptions {
  return {
    httpOnly: true,
    secure: config.get<string>('NODE_ENV', 'development') === 'production',
    sameSite: 'lax',
  };
}

/** ido_rt's path is `/auth` on purpose — the browser only attaches it to /auth/* requests (refresh, logout), never to ordinary API calls. */
export function setAuthCookies(res: Response, config: ConfigService, token: string, refreshToken: string): void {
  const base = baseOptions(config);
  res.cookie(ACCESS_COOKIE, token, { ...base, path: '/', maxAge: ACCESS_MAX_AGE_MS });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...base, path: '/auth', maxAge: REFRESH_MAX_AGE_MS });
}

export function clearAuthCookies(res: Response, config: ConfigService): void {
  const base = baseOptions(config);
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: '/auth' });
}

export function getRefreshCookie(req: { cookies?: Record<string, string> }): string | undefined {
  return req.cookies?.[REFRESH_COOKIE];
}
