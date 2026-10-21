import { ConfigService } from '@nestjs/config';

/** PEM env vars are stored `\n`-escaped on one line — undo that to get the real multi-line PEM back. */
function unescapePem(value: string): string {
  return value.replace(/\\n/g, '\n');
}

export function getAuthPrivateKey(config: ConfigService): string {
  return unescapePem(config.get<string>('AUTH_PRIVATE_KEY', ''));
}

export function getAuthPublicKey(config: ConfigService): string {
  return unescapePem(config.get<string>('AUTH_PUBLIC_KEY', ''));
}
