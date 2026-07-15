import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { DeviceType } from '../../domain/enums/authentication.enums';

export class LoginRequestDto {
  @ApiProperty({ description: 'Registered account email address', example: 'owner@example.com' })
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(320)
  email!: string;

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
