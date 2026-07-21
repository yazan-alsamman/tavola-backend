import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Full-replace semantics, matching every other update DTO in this codebase
 * (UpdateRestaurantRequestDto/UpdateUserProfileRequestDto): every field
 * required except the ones already nullable in the domain.
 */
export class UpdateBranchRequestDto {
  @ApiProperty({ example: 'Damascus' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  city!: string;

  @ApiPropertyOptional({ example: 'Malki', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  district?: string | null;

  @ApiProperty({ example: '123 Main St' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  address!: string;

  @ApiPropertyOptional({
    example: 33.5138,
    nullable: true,
    minimum: -90,
    maximum: 90,
    description: 'Must be set together with longitude, or both omitted (ADR-018)',
  })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @ApiPropertyOptional({
    example: 36.2765,
    nullable: true,
    minimum: -180,
    maximum: 180,
    description: 'Must be set together with latitude, or both omitted (ADR-018)',
  })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @ApiProperty({ example: 'SY', description: 'ISO 3166-1 alpha-2 two-letter country code' })
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be a two-letter ISO 3166-1 alpha-2 code' })
  countryCode!: string;

  @ApiPropertyOptional({
    example: 'SYP',
    nullable: true,
    description:
      'ISO 4217 three-letter currency code; falls back to the restaurant default when omitted',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a three-letter ISO 4217 code' })
  currency?: string | null;

  @ApiProperty({ example: 'Asia/Damascus' })
  @IsString()
  @IsNotEmpty()
  timezone!: string;

  @ApiPropertyOptional({ example: '+963900000000', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;
}
