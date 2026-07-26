import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Mirrors `ListFavoritesQueryDto`'s pagination pattern exactly. `unread` is
 * a query-string boolean - `enableImplicitConversion` is deliberately off
 * globally (see `validation-pipe.factory.ts`'s own comment on why), so this
 * field opts into string->boolean conversion explicitly and narrowly
 * (`"true"` only - anything else, including absence, resolves to `false`/
 * unfiltered) rather than relying on the unsafe implicit-conversion behavior
 * that bug was found and removed for.
 */
export class ListNotificationsQueryDto {
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

  @ApiPropertyOptional({
    example: true,
    description: 'When true, returns only unread notifications.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unread?: boolean = false;
}
