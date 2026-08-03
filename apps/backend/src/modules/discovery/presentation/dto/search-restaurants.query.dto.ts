import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D5-D7/D14):
 * extends `GET /discovery/restaurants`'s pre-existing `page`/`limit`
 * (shared `PaginationQueryDto`, unchanged) with optional search/filter/sort
 * params - every field here is optional, so an omitted-filters request is
 * identical to the pre-Phase-15.5 plain listing.
 */
export class SearchRestaurantsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'Old Mill',
    maxLength: 100,
    description: "D5: ILIKE '%q%' against Restaurant.name only - never description or cuisineType.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'D6: filters via the relational CuisineCategory taxonomy, never the legacy cuisineType string.',
  })
  @IsOptional()
  @IsUUID()
  cuisineId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'D6: filters via the relational OccasionCategory taxonomy.',
  })
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

  @ApiPropertyOptional({
    example: 4,
    minimum: 1,
    maximum: 5,
    description:
      'D7: filters against the persisted Restaurant.averageRating - never recomputed by this query.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({
    example: 'Damascus',
    maxLength: 100,
    description:
      'Matches Branch.city (case-insensitive) - a restaurant qualifies if it has a qualifying non-deleted branch in this city.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ enum: ['name', 'rating', 'newest'] })
  @IsOptional()
  @IsIn(['name', 'rating', 'newest'])
  sort?: 'name' | 'rating' | 'newest';

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    description:
      'Overrides the default direction for the chosen sort (name: asc, rating: desc, newest: desc).',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
