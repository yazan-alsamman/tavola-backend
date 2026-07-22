import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { PhoneIdentifierRequestDto } from './phone-identifier.request.dto';

export class CompleteCustomerPasswordResetRequestDto extends PhoneIdentifierRequestDto {
  @ApiProperty({ example: 'NewSecurePass123!', minLength: 12 })
  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}
