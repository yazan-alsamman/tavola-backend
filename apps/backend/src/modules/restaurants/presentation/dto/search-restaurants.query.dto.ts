import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import { EmptyStringToUndefined } from '@common/decorators/empty-to-undefined.decorator';
import { RestaurantLookupStatusFilter } from '../../application/ports/platform-admin-restaurant-lookup-reader.port';

/** The exact values `status` accepts — kept next to the DTO that validates them. */
export const RESTAURANT_LOOKUP_STATUS_FILTERS: readonly RestaurantLookupStatusFilter[] = [
  'Active',
  'Suspended',
  'Deleted',
];

export class SearchRestaurantsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive partial match on name or slug. Omitted, empty, or whitespace-only returns the ordinary paginated list rather than an empty result.',
    example: 'mill',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    description:
      'Lifecycle filter. `Active`/`Suspended` match the status column and exclude soft-deleted rows; `Deleted` matches soft-deleted rows regardless of status. Omitted returns every Restaurant, soft-deleted included.',
    enum: RESTAURANT_LOOKUP_STATUS_FILTERS,
    example: 'Active',
  })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(RESTAURANT_LOOKUP_STATUS_FILTERS)
  status?: RestaurantLookupStatusFilter;
}
