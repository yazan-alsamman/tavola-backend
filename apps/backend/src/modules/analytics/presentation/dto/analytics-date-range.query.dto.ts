import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RANGE_PRESETS = ['today', 'last7d', 'last30d', 'thisMonth'] as const;

/**
 * Phase 14 (Analytics, ADR-028 D5). Either `range` or `dateFrom`/`dateTo`,
 * never both - `ResolveAnalyticsDateRangeService` rejects the contradictory
 * combination. Max span 366 days, also enforced by that service.
 */
export class AnalyticsDateRangeQueryDto {
  @ApiPropertyOptional({ enum: RANGE_PRESETS, example: 'last30d' })
  @IsOptional()
  @IsIn(RANGE_PRESETS)
  range?: 'today' | 'last7d' | 'last30d' | 'thisMonth';

  @ApiPropertyOptional({ example: '2026-07-01', description: 'YYYY-MM-DD, inclusive' })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dateFrom must be a YYYY-MM-DD date' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-07-28', description: 'YYYY-MM-DD, inclusive' })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dateTo must be a YYYY-MM-DD date' })
  dateTo?: string;
}

/** Restaurant/Organization-scope routes only - optionally narrows to one Branch. */
export class AnalyticsDateRangeWithBranchQueryDto extends AnalyticsDateRangeQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
