import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewImageResponseDto {
  @ApiProperty({ format: 'uuid' })
  reviewImageId!: string;

  @ApiProperty({
    example: 'https://minio.example.com/tavla-public/reviews/.../images/....jpg?X-Amz-...',
    description: 'A freshly-generated, time-limited signed URL - never cache this value long-term.',
  })
  imageUrl!: string;

  @ApiProperty({ example: 0 })
  sortOrder!: number;
}

export class RestaurantReplyResponseDto {
  @ApiProperty({ example: 'Thank you so much for the kind words!' })
  comment!: string;

  @ApiProperty({ example: '2026-07-26T12:00:00.000Z' })
  createdAt!: string;
}

/**
 * Public projection (owner decision #14): `reviewerUsername` only - never
 * `userId`, real name, phone, email, or `ReservationGuest` data. Explicit
 * response DTO, never a direct serialization of the domain/database Review.
 */
export class ReviewResponseDto {
  @ApiProperty({ format: 'uuid' })
  reviewId!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ format: 'uuid' })
  reservationId!: string;

  @ApiPropertyOptional({ example: 'jane_doe', nullable: true })
  reviewerUsername!: string | null;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  rating!: number;

  @ApiPropertyOptional({ example: 'Wonderful evening, great service.', nullable: true })
  comment!: string | null;

  @ApiProperty({ type: [ReviewImageResponseDto] })
  images!: ReviewImageResponseDto[];

  @ApiPropertyOptional({ type: RestaurantReplyResponseDto, nullable: true })
  reply!: RestaurantReplyResponseDto | null;

  @ApiProperty({ example: '2026-07-26T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-26T12:00:00.000Z' })
  updatedAt!: string;
}

export class ReviewListResponseDto {
  @ApiProperty({ type: [ReviewResponseDto] })
  items!: ReviewResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;
}
