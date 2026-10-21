import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { getAuthPublicKey } from '../jwt-keys';

/** No email/phone in the token — base64 isn't encryption, anyone holding it can read the payload. */
export type JwtPayload = { sub: string; role: string };
export type AuthenticatedUser = { userId: string; role: string };

/** Cookie first (the website), falling back to a Bearer header (a future native app — it has no cookies at all). */
function extractFromCookieOrHeader(req: Request): string | null {
  return req.cookies?.ido_at ?? ExtractJwt.fromAuthHeaderAsBearerToken()(req);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: extractFromCookieOrHeader,
      ignoreExpiration: false,
      secretOrKey: getAuthPublicKey(config),
      algorithms: ['ES256'],
      issuer: config.get<string>('JWT_ISSUER', 'https://api.idowellness.ai'),
      audience: config.get<string>('JWT_AUDIENCE', 'ido'),
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    return { userId: payload.sub, role: payload.role };
  }
}
