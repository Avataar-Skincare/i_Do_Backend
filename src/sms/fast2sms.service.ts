import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const FAST2SMS_URL = 'https://www.fast2sms.com/dev/bulkV2';

/**
 * Same Fast2SMS DLT route the Client repo (avataarskin.com) uses for its own
 * signup/login OTP — ported here rather than imported, since that repo is a
 * separate deployable with its own lifecycle. Unlike that repo's version,
 * failures are not swallowed: a customer waiting on a login code needs to
 * know the SMS didn't go out, not silently hang.
 */
@Injectable()
export class Fast2SmsService {
  private readonly logger = new Logger(Fast2SmsService.name);

  constructor(private readonly config: ConfigService) {}

  async sendOtp(phone: string, otp: string): Promise<void> {
    const apiKey = this.config.get<string>('FAST2SMS_API_KEY', '');
    if (!apiKey) {
      throw new Error('Fast2SMS is not configured — set FAST2SMS_API_KEY');
    }

    // Reused from the Client repo's own registered DLT sender/template as a
    // starting point — this template's approved text is registered under
    // Avataar's DLT entity, not "i do" specifically. Confirm with Fast2SMS/DLT
    // that this template's wording is acceptable to send under the i do brand
    // before relying on this in production; override via env if a dedicated
    // i do template gets registered.
    const senderId = this.config.get<string>('FAST2SMS_SENDER_ID', 'AVTSKC');
    const templateId = this.config.get<string>('FAST2SMS_OTP_TEMPLATE_ID', '185443');

    const url = new URL(FAST2SMS_URL);
    url.searchParams.set('authorization', apiKey);
    url.searchParams.set('route', 'dlt');
    url.searchParams.set('sender_id', senderId);
    url.searchParams.set('message', templateId);
    url.searchParams.set('variables_values', `${otp}|`);
    url.searchParams.set('flash', '0');
    url.searchParams.set('numbers', phone);

    const res = await fetch(url.toString());
    const body: unknown = await res.json().catch(() => null);

    if (!res.ok || (body && typeof body === 'object' && 'return' in body && body.return === false)) {
      this.logger.error(`Fast2SMS send failed for ${phone}: ${res.status} ${JSON.stringify(body)}`);
      throw new Error('Failed to send the SMS code — please try again.');
    }
  }
}
