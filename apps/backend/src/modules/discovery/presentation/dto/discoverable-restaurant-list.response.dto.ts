import { ApiProperty } from '@nestjs/swagger';
import { DiscoverableRestaurantResponseDto } from './discoverable-restaurant.response.dto';

export class DiscoverableRestaurantListResponseDto {
  @ApiProperty({ type: [DiscoverableRestaurantResponseDto] })
  items!: DiscoverableRestaurantResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 0 })
  total!: number;
}
