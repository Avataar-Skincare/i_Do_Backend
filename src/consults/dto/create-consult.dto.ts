import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import type { ConsultType } from '../entities/consult.entity';

export class CreateConsultDto {
  @IsString()
  @IsNotEmpty()
  clientId: string;

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
