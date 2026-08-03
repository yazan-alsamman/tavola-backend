import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Post-Audit Remediation (2026-08-02, L6). API_GUIDELINES.md's Pagination
 * section (`page`/`limit`) was hand-duplicated near-identically across 9+
 * modules; this is the single shared definition every list-query DTO now
 * extends. Explicit `@Type(() => Number)` - query-string values always
 * arrive as strings (`?page=2`) and need converting to a real number before
 * `@IsInt()`/`@Min()` can validate them; the global `ValidationPipe` does
 * not do this implicitly (see `validation-pipe.factory.ts`'s own comment
 * for why).
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
