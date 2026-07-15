import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Mirrors API_GUIDELINES.md's Pagination section (`page`/`limit`). Explicit
 * `@Type(() => Number)` - query-string values always arrive as strings
 * (`?page=2`) and need converting to a real number before `@IsInt()`/`@Min()`
 * can validate them; the global `ValidationPipe` no longer does this
 * implicitly (see `validation-pipe.factory.ts`'s own comment for why).
 */
export class ListFavoritesQueryDto {
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
