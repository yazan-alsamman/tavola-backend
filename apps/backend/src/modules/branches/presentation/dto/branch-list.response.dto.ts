import { ApiProperty } from '@nestjs/swagger';
import { BranchResponseDto } from './branch.response.dto';

export class BranchListResponseDto {
  @ApiProperty({ type: [BranchResponseDto] })
  items!: BranchResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 3 })
  total!: number;
}
