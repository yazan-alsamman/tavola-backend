import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import { EmptyStringToUndefined } from '@common/decorators/empty-to-undefined.decorator';
import { OrganizationLookupStatusFilter } from '../../application/ports/platform-admin-organization-stats-reader.port';

/**
 * The exact values `status` accepts. `Closed` is deliberately excluded —
 * ADR-034 §4/§5 records it as an unused, undocumented enum value no
 * PlatformAdmin action ever writes.
 */
export const ORGANIZATION_LOOKUP_STATUS_FILTERS: readonly OrganizationLookupStatusFilter[] = [
  'Active',
  'Suspended',
  'Deleted',
];

export class SearchOrganizationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive partial match on name or slug. Omitted, empty, or whitespace-only returns the ordinary paginated list rather than an empty result.',
    example: 'acme',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    description:
      'Lifecycle filter. `Active`/`Suspended` match the status column and exclude soft-deleted rows; `Deleted` matches soft-deleted rows regardless of status. Omitted returns every Organization, soft-deleted included.',
    enum: ORGANIZATION_LOOKUP_STATUS_FILTERS,
    example: 'Active',
  })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(ORGANIZATION_LOOKUP_STATUS_FILTERS)
  status?: OrganizationLookupStatusFilter;
}
