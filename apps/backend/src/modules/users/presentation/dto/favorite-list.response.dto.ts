import { ApiProperty } from '@nestjs/swagger';

export class FavoriteListItemResponseDto {
  @ApiProperty({ example: '22222222-2222-4222-8222-222222222222' })
  restaurantId!: string;

  @ApiProperty({ example: 'The Old Mill' })
  name!: string;

  @ApiProperty({ example: 'the-old-mill' })
  slug!: string;

  @ApiProperty({ example: 'Italian', nullable: true })
  cuisineType!: string | null;

  @ApiProperty({ example: 2, nullable: true, minimum: 1, maximum: 4 })
  priceLevel!: number | null;

  @ApiProperty({ example: 4.5, nullable: true })
  averageRating!: number | null;

  @ApiProperty({ example: 'Active' })
  status!: string;

  @ApiProperty({ example: '2026-07-14T12:00:00.000Z' })
  favoritedAt!: string;
}

/**
 * Pagination fields are embedded directly in `data` rather than the
 * envelope's `meta` object: `ResponseEnvelopeInterceptor` hardcodes
 * `meta: {}` today (no endpoint before this one has needed real pagination
 * metadata), so extending the shared interceptor for this one endpoint would
 * be out-of-scope common-infrastructure surgery. A documented judgment call,
 * not an oversight.
 */
export class FavoriteListResponseDto {
  @ApiProperty({ type: [FavoriteListItemResponseDto] })
  items!: FavoriteListItemResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;
}
