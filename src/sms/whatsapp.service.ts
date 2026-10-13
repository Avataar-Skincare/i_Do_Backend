import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Ported from the Client repo's MessagesService/NotificationService.sendOtpOnWhatsapp
 * — an internal "Messenger" WhatsApp Business gateway, not Twilio/Meta directly.
 * Always best-effort: the SMS code is the one that actually gates login, so a
 * WhatsApp outage should never block someone who already has the SMS in hand —
 * failures here are logged, never thrown.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private readonly config: ConfigService) {}

  async sendOtp(phone: string, otp: string): Promise<void> {
    const webhookUrl = this.config.get<string>('MESSENGER_WEBHOOK_URL', '');
    const apiKey = this.config.get<string>('MESSENGER_API_KEY', '');
    if (!webhookUrl || !apiKey) {
      this.logger.warn('WhatsApp OTP skipped — MESSENGER_WEBHOOK_URL/MESSENGER_API_KEY not configured');
      return;
    }

    // Workspace/template reused from the Client repo's own registration — see
    // the same brand-mismatch caveat as Fast2SmsService: confirm this
    // template's approved wording before relying on it for i do in production.
    const workspaceId = this.config.get<string>('MESSENGER_WORKSPACE_ID', '2');
    const templateName = this.config.get<string>('MESSENGER_OTP_TEMPLATE', 'otp9');
    const url = `${webhookUrl}/api/external/workspaces/${workspaceId}/send-template`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          template_name: templateName,
          receivers: [{ whatsappNumber: `91${phone}`, customParams: [{ name: '1', value: otp }] }],
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.logger.warn(`WhatsApp OTP send failed for ${phone}: ${res.status}`);
      }
    } catch (err) {
      this.logger.warn(`WhatsApp OTP send failed for ${phone}: ${(err as Error).message}`);
    }
  }
}
