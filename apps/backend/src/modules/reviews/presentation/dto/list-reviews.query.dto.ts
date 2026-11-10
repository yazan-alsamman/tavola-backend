import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import { REVIEW_AXES, ReviewAxis } from '../../domain/entities/review.entity';

/**
 * The project-wide `page`/`limit` convention (owner decision #26) plus the
 * axis/stars filter (ADR-045). `stars` alone filters the whole-star rating;
 * with `axis` it filters that axis's stars.
 */
export class ListReviewsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: REVIEW_AXES, description: 'Filter by one axis (with `stars`).' })
  @IsOptional()
  @IsIn(REVIEW_AXES)
  axis?: ReviewAxis;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  stars?: number;
}
