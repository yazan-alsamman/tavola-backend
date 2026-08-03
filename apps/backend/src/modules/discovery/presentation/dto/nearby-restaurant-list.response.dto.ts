import { ApiProperty } from '@nestjs/swagger';
import { NearbyRestaurantResponseDto } from './nearby-restaurant.response.dto';

export class NearbyRestaurantListResponseDto {
  @ApiProperty({ type: [NearbyRestaurantResponseDto] })
  items!: NearbyRestaurantResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 0 })
  total!: number;
}
