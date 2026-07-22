import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { PhoneIdentifierRequestDto } from './phone-identifier.request.dto';

export class VerifyCustomerPasswordResetRequestDto extends PhoneIdentifierRequestDto {
  @ApiProperty({ description: 'The 6-digit WhatsApp verification code', example: '004821' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/)
  code!: string;
}
