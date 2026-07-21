import { ApiProperty } from '@nestjs/swagger';

export class OccasionCategoryResponseDto {
  @ApiProperty({ example: '22222222-2222-4222-8222-222222222222' })
  occasionCategoryId!: string;

  @ApiProperty({ example: 'date-night' })
  slug!: string;

  @ApiProperty({ example: 'Date Night' })
  name!: string;

  @ApiProperty({ example: 0 })
  sortOrder!: number;

  @ApiProperty({ example: '2026-07-16T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-16T12:00:00.000Z' })
  updatedAt!: string;
}

export class OccasionCategoryListResponseDto {
  @ApiProperty({ type: [OccasionCategoryResponseDto] })
  items!: OccasionCategoryResponseDto[];
}

export class RestaurantOccasionCategoriesResponseDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  restaurantId!: string;

  @ApiProperty({ type: [OccasionCategoryResponseDto] })
  categories!: OccasionCategoryResponseDto[];
}
