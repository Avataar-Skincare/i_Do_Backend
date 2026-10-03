import { IsNotEmpty, IsString } from 'class-validator';

/** Body for both the customer's and partner-app's reschedule endpoints. */
export class RescheduleConsultDto {
  @IsString()
  @IsNotEmpty()
  dayLabel: string;

  @IsString()
  @IsNotEmpty()
  timeSlot: string;
}
