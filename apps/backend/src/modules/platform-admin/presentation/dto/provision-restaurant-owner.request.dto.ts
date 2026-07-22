import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { RegisterConsentsRequestDto } from '@modules/authentication/presentation/dto/register-consents.request.dto';

/**
 * ADR-022 §"Restaurant Owner Provisioning": same organization/owner data
 * `RegisterRequestDto` already collects, minus `intent` (there is no other
 * option here) - submitted by an authenticated Platform Admin, not the
 * public.
 */
export class ProvisionRestaurantOwnerRequestDto {
  @ApiProperty({ example: 'owner@example.com' })
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: 'SecurePass123!', minLength: 12 })
  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: 'Jane' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @ApiPropertyOptional({ example: '+963900000000' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiProperty({ example: 'Acme Restaurant Group' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  organizationName!: string;

  @ApiProperty({ type: () => RegisterConsentsRequestDto })
  @ValidateNested()
  @Type(() => RegisterConsentsRequestDto)
  consents!: RegisterConsentsRequestDto;
}
