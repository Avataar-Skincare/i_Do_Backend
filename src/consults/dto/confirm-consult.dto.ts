import { IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Body for partner-app-server's callback once a staff member books a real doctor. */
export class ConfirmConsultDto {
  @IsString()
  @IsNotEmpty()
  doctorName: string;

  @IsOptional()
  @IsString()
  meetingLink?: string;

  /** ISO datetime, in case the confirmed slot differs from what the customer requested. */
  @IsOptional()
  @IsISO8601()
  appointmentAt?: string;
}
