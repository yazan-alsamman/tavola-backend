import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RestaurantStatus } from '../../domain/enums/restaurant.enums';

export class RestaurantResponseDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  restaurantId!: string;

  @ApiProperty({ example: 'The Old Mill' })
  name!: string;

  @ApiProperty({ example: 'the-old-mill' })
  slug!: string;

  @ApiPropertyOptional({ example: null, nullable: true })
  logoId!: string | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  coverImageId!: string | null;

  @ApiPropertyOptional({ example: 'A cozy neighborhood restaurant.', nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ example: 'Italian', nullable: true })
  cuisineType!: string | null;

  @ApiPropertyOptional({ example: null, nullable: true, description: 'Computed by Reviews.' })
  averageRating!: number | null;

  @ApiPropertyOptional({ example: 2, nullable: true, minimum: 1, maximum: 4 })
  priceLevel!: number | null;

  @ApiProperty({ enum: RestaurantStatus, example: RestaurantStatus.Active })
  status!: string;

  @ApiProperty({ example: '2026-07-16T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-16T12:00:00.000Z' })
  updatedAt!: string;
}
