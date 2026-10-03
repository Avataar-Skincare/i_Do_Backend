import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { ContactDto } from './dto/contact.dto';

/** Minimal HTML-escaping — this content lands straight in an email body, so don't trust it as-is. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

@Injectable()
export class ContactService {
  private readonly supportAddress: string;

  constructor(
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {
    this.supportAddress = this.config.get<string>('MAIL_FROM_ADDRESS', 'support@idowellness.ai');
  }

  /**
   * Sent to the same verified address this service already sends *from*
   * (MAIL_FROM_ADDRESS) — the business emails itself the enquiry, with
   * `replyTo` set to the customer so hitting reply goes straight to them.
   */
  async send(dto: ContactDto): Promise<{ message: string }> {
    await this.mailService.sendEmail({
      to: this.supportAddress,
      replyTo: dto.email,
      subject: `New contact form message from ${dto.name}`,
      html: `
        <p><strong>From:</strong> ${escapeHtml(dto.name)} (${escapeHtml(dto.email)})</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(dto.message).replace(/\n/g, '<br>')}</p>
      `,
    });

    return { message: "Thanks — we'll get back to you soon." };
  }
}
