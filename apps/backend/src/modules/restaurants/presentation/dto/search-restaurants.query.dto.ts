import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';

export class SearchRestaurantsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive partial match on name or slug.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
