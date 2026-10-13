import { Matches } from 'class-validator';

export class SendPhoneOtpDto {
  @Matches(/^\d{10}$/, { message: 'Enter a valid 10-digit phone number' })
  phone: string;
}
