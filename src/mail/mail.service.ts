import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type SESTransport from 'nodemailer/lib/ses-transport';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  /** Defaults to MAIL_FROM_ADDRESS — override only for a different verified sender. */
  from?: string;
  /** So hitting "reply" on a forwarded message (e.g. a contact-form submission) goes straight to the customer. */
  replyTo?: string;
};

/**
 * AWS SES via nodemailer — the same pattern already proven in partner-app-server's
 * glp-consent-email.service.js, ported to NestJS. Deliberately reuses the exact
 * same env var names (AWS_REGION, AWS_SES_ACCESS_KEY_ID, AWS_SES_SECRET_ACCESS_KEY)
 * as that service, so whoever holds the AWS credentials can drop the same values
 * into both services' .env files without renaming anything.
 *
 * idowellness.ai must be a verified SES identity (domain or the sender address
 * itself) before any of this can actually deliver — see MAIL_FROM_ADDRESS below.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly defaultFrom: string;

  constructor(private readonly config: ConfigService) {
    const sesClient = new SESv2Client({
      region: this.config.get<string>('AWS_REGION'),
      credentials: {
        accessKeyId: this.config.get<string>('AWS_SES_ACCESS_KEY_ID', ''),
        secretAccessKey: this.config.get<string>('AWS_SES_SECRET_ACCESS_KEY', ''),
      },
    });

    // Same nodemailer SES transport shape as partner-app-server: pass the v2
    // client + command class directly, not the legacy { ses, aws } config.
    // Explicitly typed as SESTransport.Options — otherwise TS's overload
    // resolution for createTransport() doesn't pick this shape up from a
    // plain inline object literal. `sendingRate` is a real, documented SES
    // transport option that @types/nodemailer (8.0.2) hasn't caught up to
    // yet for nodemailer 9.x — intersected in rather than left untyped.
    const transportOptions: SESTransport.Options & { sendingRate?: number } = {
      SES: { sesClient, SendEmailCommand },
      sendingRate: 14,
    };
    this.transporter = nodemailer.createTransport(transportOptions);

    this.defaultFrom = this.config.get<string>('MAIL_FROM_ADDRESS', 'support@idowellness.ai');
  }

  async sendEmail({ to, subject, html, from, replyTo }: SendEmailInput): Promise<void> {
    try {
      await this.transporter.sendMail({ from: from ?? this.defaultFrom, to, subject, html, replyTo });
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}: ${(err as Error).message}`);
      throw err;
    }
  }
}
