import { ApiProperty } from '@nestjs/swagger';
import { BranchReservationItemResponseDto } from './branch-reservation-item.response.dto';

export class BranchReservationListResponseDto {
  @ApiProperty({ type: [BranchReservationItemResponseDto] })
  items!: BranchReservationItemResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 0 })
  total!: number;
}
