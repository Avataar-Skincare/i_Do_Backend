import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import type { ConsultType } from '../entities/consult.entity';

export class CreateConsultDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  /**
   * Collected independently of the account, same as `phone`/`name` — an
   * account can now sign up with just a phone (no email), so this can't be
   * read from the JWT the way it used to be (see ConsultsController.create).
   */
  @IsEmail()
  email: string;

  @IsIn(['derm', 'dietician'])
  type: ConsultType;

  @IsString()
  @IsNotEmpty()
  dayLabel: string;

  @IsString()
  @IsNotEmpty()
  timeSlot: string;

  @IsOptional()
  @IsString()
  concern?: string;
}
