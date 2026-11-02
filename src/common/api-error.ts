import { HttpException } from '@nestjs/common';

/**
 * An HTTP error in the API contract's shape: `{statusCode, message, code}`
 * with a stable machine-readable `code` (api/openapi.yaml → Error).
 */
export function apiError(
  statusCode: number,
  code: string,
  message: string,
): HttpException {
  return new HttpException({ statusCode, message, code }, statusCode);
}
