import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D2-D4):
 * `GET /discovery/restaurants/nearby` - `lat`/`lng` are required (D3: this is
 * the client-supplied-coordinates location mode; city-text search remains
 * `SearchRestaurantsQueryDto.city` on the plain search route). `sort` is
 * deliberately not accepted here - nearby results are always ordered
 * `distance ASC` (D4), not overridable in v1.
 */
export class NearbyRestaurantsQueryDto extends PaginationQueryDto {
  @ApiProperty({ example: 33.5138, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: 36.2765, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiPropertyOptional({
    example: 5,
    default: 5,
    minimum: 0.1,
    maximum: 50,
    description: 'Kilometers. Default 5, max 50 (D4).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(50)
  radiusKm?: number = 5;

  @ApiPropertyOptional({ example: 'Old Mill', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cuisineId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  occasionId?: string;

  @ApiPropertyOptional({ example: 2, minimum: 1, maximum: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  priceLevel?: number;

  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(5)
  minRating?: number;
}
