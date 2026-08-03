import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';

/**
 * Extends the shared `PaginationQueryDto`. `unread` is a query-string
 * boolean - `enableImplicitConversion` is deliberately off globally (see
 * `validation-pipe.factory.ts`'s own comment on why), so this field opts
 * into string->boolean conversion explicitly and narrowly (`"true"` only -
 * anything else, including absence, resolves to `false`/unfiltered) rather
 * than relying on the unsafe implicit-conversion behavior that bug was
 * found and removed for.
 */
export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: true,
    description: 'When true, returns only unread notifications.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unread?: boolean = false;
}
