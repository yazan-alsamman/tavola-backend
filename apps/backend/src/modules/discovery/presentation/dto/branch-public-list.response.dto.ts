import { ApiProperty } from '@nestjs/swagger';
import { BranchPublicResponseDto } from './branch-public.response.dto';

export class BranchPublicListResponseDto {
  @ApiProperty({ type: [BranchPublicResponseDto] })
  items!: BranchPublicResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 3 })
  total!: number;
}
