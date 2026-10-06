import { IsString, Length } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  @Length(6, 6, { message: 'code must be 6 digits' })
  code: string;
}
