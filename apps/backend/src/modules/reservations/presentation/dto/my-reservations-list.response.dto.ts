import { ApiProperty } from '@nestjs/swagger';
import { MyReservationItemResponseDto } from './my-reservation-item.response.dto';

export class MyReservationsListResponseDto {
  @ApiProperty({ type: [MyReservationItemResponseDto] })
  items!: MyReservationItemResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 0 })
  total!: number;
}
