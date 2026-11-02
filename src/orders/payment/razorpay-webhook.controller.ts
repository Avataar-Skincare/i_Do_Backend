import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { RazorpayWebhookService } from './razorpay-webhook.service';

/** Called by Razorpay, not a browser: no auth cookie, no X-Requested-With — the HMAC is the auth. */
@Controller('webhooks')
export class RazorpayWebhookController {
  constructor(private readonly webhook: RazorpayWebhookService) {}

  /** The HMAC is over the exact bytes Razorpay sent, so this reads req.rawBody (main.ts: rawBody: true). */
  @Post('razorpay')
  @HttpCode(200)
  handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined,
  ) {
    return this.webhook.handle(req.rawBody, signature, eventId);
  }
}
