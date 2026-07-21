import { ApiProperty } from '@nestjs/swagger';
import { TableResponseDto } from './table.response.dto';

export class TableListResponseDto {
  @ApiProperty({ type: [TableResponseDto] })
  items!: TableResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 2 })
  total!: number;
}
