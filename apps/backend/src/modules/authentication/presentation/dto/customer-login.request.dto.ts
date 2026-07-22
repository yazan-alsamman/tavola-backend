import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { DeviceType } from '../../domain/enums/authentication.enums';
import { PhoneIdentifierRequestDto } from './phone-identifier.request.dto';

/** ADR-022 Decision #10/#17: a fully separate contract from `LoginRequestDto` - never a discriminated union. */
export class CustomerLoginRequestDto extends PhoneIdentifierRequestDto {
  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ example: 'iPhone 15' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceName?: string;

  @ApiPropertyOptional({ enum: DeviceType, example: DeviceType.Mobile })
  @IsOptional()
  @IsEnum(DeviceType)
  deviceType?: DeviceType;
}
