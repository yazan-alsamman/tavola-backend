import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { PhoneIdentifierRequestDto } from './phone-identifier.request.dto';

export class CompleteCustomerRegistrationRequestDto extends PhoneIdentifierRequestDto {
  @ApiProperty({ example: 'SecurePass123!', minLength: 12 })
  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
