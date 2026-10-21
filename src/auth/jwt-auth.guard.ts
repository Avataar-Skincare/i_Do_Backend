import { ExecutionContext, ForbiddenException, HttpStatus, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense-in-depth for the cookie-auth path only (the website). SameSite=Lax already blocks
 * most cross-site cookie sends, but requiring a header that only JavaScript can set closes the
 * remaining gap (a bare HTML form can't send it). The contract requires `X-Requested-With: ido` on
 * every state-changing request (POST/PUT/PATCH/DELETE); a missing or wrong value is 403 FORBIDDEN.
 * A Bearer-token caller (the app) has no ambient cookie for another site to ride, so it is exempt.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const usingCookieAuth = !!req.cookies?.ido_at;
    if (usingCookieAuth && !SAFE_METHODS.has(req.method) && req.headers['x-requested-with'] !== 'ido') {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Missing X-Requested-With header.',
        code: 'FORBIDDEN',
      });
    }
    return super.canActivate(context);
  }
}
