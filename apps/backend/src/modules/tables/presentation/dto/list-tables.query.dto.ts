import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import { EmptyStringToUndefined } from '@common/decorators/empty-to-undefined.decorator';

export class ListTablesQueryDto extends PaginationQueryDto {
  /**
   * ADR-040 - honored only by the floor-plan-scoped list route, which is the
   * only one where "an area of this plan" is a meaningful scope; the
   * branch-scoped list spans every plan of the branch and ignores it.
   *
   * `@EmptyStringToUndefined` for the same reason as every other optional
   * filter in this codebase (Phase 19.10 Defect 4): a form-driven client sends
   * `?floorPlanAreaId=` when nothing is selected, and `@IsOptional()` alone
   * would let that empty string reach `@IsUUID()` and 400.
   */
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Narrow the result to one dining area of this floor plan. Must be a live area of the floor plan in the path; omit it for the whole plan.',
  })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsUUID()
  floorPlanAreaId?: string;
}
