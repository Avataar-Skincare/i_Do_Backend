import { Module } from '@nestjs/common';
import { Fast2SmsService } from './fast2sms.service';
import { WhatsappService } from './whatsapp.service';

@Module({
  providers: [Fast2SmsService, WhatsappService],
  exports: [Fast2SmsService, WhatsappService],
})
export class SmsModule {}
