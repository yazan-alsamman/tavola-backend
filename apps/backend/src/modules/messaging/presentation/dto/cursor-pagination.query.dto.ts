import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** DECISIONS.md D13 - opaque cursor (keyset pagination), default 50 / max 100. */
export class CursorPaginationQueryDto {
  @ApiPropertyOptional({
    description: "Opaque cursor from a previous page's nextCursor. Omit for the first page.",
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ example: 50, default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
