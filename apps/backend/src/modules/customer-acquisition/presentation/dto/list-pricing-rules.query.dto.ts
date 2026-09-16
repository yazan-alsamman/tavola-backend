import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import { EmptyStringToUndefined } from '@common/decorators/empty-to-undefined.decorator';

/** ADR-034 §13 — narrow lookup, `label` (ILIKE) and `id` (exact) both optional. */
export class ListPricingRulesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive partial match on label.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  // `?id=` (present but blank) must mean "no id filter", exactly like every
  // other optional filter in this API — without the transform it reaches
  // `@IsUUID()` as `''` and returns 400.
  @ApiPropertyOptional({ format: 'uuid' })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsUUID()
  id?: string;
}
