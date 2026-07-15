import { ApiProperty } from '@nestjs/swagger';
import { RestaurantResponseDto } from './restaurant.response.dto';

export class RestaurantListResponseDto {
  @ApiProperty({ type: [RestaurantResponseDto] })
  items!: RestaurantResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 0 })
  total!: number;
}
