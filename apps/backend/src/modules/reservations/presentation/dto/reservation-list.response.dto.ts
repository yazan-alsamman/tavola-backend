import { ApiProperty } from '@nestjs/swagger';
import { ReservationResponseDto } from './reservation.response.dto';

export class ReservationListResponseDto {
  @ApiProperty({ type: [ReservationResponseDto] })
  items!: ReservationResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 0 })
  total!: number;
}
