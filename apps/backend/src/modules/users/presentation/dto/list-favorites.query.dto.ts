import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';

/** Mirrors API_GUIDELINES.md's Pagination section (`page`/`limit`) via the
 *  shared `PaginationQueryDto` base - see that file for the rationale. */
export class ListFavoritesQueryDto extends PaginationQueryDto {
  /**
   * Backward-compatible alias for `limit`. The published customer app
   * (1.0.2) calls `GET /users/me/favorites?page=1&pageSize=20`, and
   * `forbidNonWhitelisted` rejected every one of those requests with 400.
   * Accepting it keeps installed apps working. `limit` always carries its
   * default, so `pageSize` takes precedence whenever it is sent.
   */
  @ApiPropertyOptional({
    example: 20,
    minimum: 1,
    maximum: 100,
    description: 'Deprecated alias for `limit`, accepted for older app builds.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
