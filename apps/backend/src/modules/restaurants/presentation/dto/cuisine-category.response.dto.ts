import { ApiProperty } from '@nestjs/swagger';

export class CuisineCategoryResponseDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  cuisineCategoryId!: string;

  @ApiProperty({ example: 'italian' })
  slug!: string;

  @ApiProperty({ example: 'Italian' })
  name!: string;

  @ApiProperty({ example: 0 })
  sortOrder!: number;

  @ApiProperty({ example: '2026-07-16T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-16T12:00:00.000Z' })
  updatedAt!: string;
}

export class CuisineCategoryListResponseDto {
  @ApiProperty({ type: [CuisineCategoryResponseDto] })
  items!: CuisineCategoryResponseDto[];
}

export class RestaurantCuisineCategoriesResponseDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  restaurantId!: string;

  @ApiProperty({ type: [CuisineCategoryResponseDto] })
  categories!: CuisineCategoryResponseDto[];
}
