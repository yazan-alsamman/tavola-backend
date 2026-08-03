import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { CursorPaginationQueryDto } from './cursor-pagination.query.dto';

export class ListCustomerConversationsQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Include conversations the Customer has archived (DECISIONS.md D11).',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeArchived?: boolean;
}
