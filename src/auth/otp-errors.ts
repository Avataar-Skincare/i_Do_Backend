import { HttpException, HttpStatus } from '@nestjs/common';

/** 429 OTP_RATE_LIMIT, with the seconds to wait so the controller can set Retry-After. */
export class OtpRateLimitException extends HttpException {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message, code: 'OTP_RATE_LIMIT' }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/** 401 OTP_INVALID: wrong, expired or burned code. */
export class OtpInvalidException extends HttpException {
  constructor() {
    super(
      { statusCode: HttpStatus.UNAUTHORIZED, message: 'That code is invalid or has expired.', code: 'OTP_INVALID' },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
