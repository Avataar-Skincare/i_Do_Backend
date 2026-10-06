import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Machine-to-machine auth for partner-app-server's callbacks (list pending
 * leads, confirm a booking) — there's no logged-in customer involved, so the
 * JWT guards don't apply. Compares the `x-api-key` header against
 * PARTNER_APP_API_KEY, mirroring partner-app-server's own LUME_BACKEND_API_KEY
 * convention for its outbound calls.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const providedKey = req.header('x-api-key');
    const expectedKey = this.config.get<string>('PARTNER_APP_API_KEY');

    if (!expectedKey || providedKey !== expectedKey) {
      throw new UnauthorizedException('Invalid API key');
    }
    return true;
  }
}
