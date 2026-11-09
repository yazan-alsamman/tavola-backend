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

export class ReviewAxisResponseDto {
  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  rating!: number;

  @ApiPropertyOptional({ example: 'Quick and friendly.', nullable: true })
  comment!: string | null;
}

/** The three axes a guest rates (ADR-045). */
export class ReviewAxesResponseDto {
  @ApiProperty({ type: ReviewAxisResponseDto })
  service!: ReviewAxisResponseDto;

  @ApiProperty({ type: ReviewAxisResponseDto })
  place!: ReviewAxisResponseDto;

  @ApiProperty({ type: ReviewAxisResponseDto })
  food!: ReviewAxisResponseDto;
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

  @ApiProperty({
    example: 5,
    minimum: 1,
    maximum: 5,
    description: 'Whole stars. For a three-axis review, the rounded score.',
  })
  rating!: number;

  @ApiPropertyOptional({ example: 'Wonderful evening, great service.', nullable: true })
  comment!: string | null;

  @ApiProperty({
    example: 4.67,
    description:
      'Average of the three axes (two decimals), or `rating` for a single-rating review.',
  })
  score!: number;

  @ApiPropertyOptional({
    type: ReviewAxesResponseDto,
    nullable: true,
    description: 'Null for a single-rating review (app 1.0.2).',
  })
  axes!: ReviewAxesResponseDto | null;

  @ApiProperty({
    example: false,
    description: 'The restaurant opened this review; its guest may rate again (PUT /reviews/:id).',
  })
  openForRerating!: boolean;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    description: 'When the guest last rated again.',
  })
  reratedAt!: string | null;

  @ApiProperty({ type: [ReviewImageResponseDto] })
  images!: ReviewImageResponseDto[];

  @ApiPropertyOptional({ type: RestaurantReplyResponseDto, nullable: true })
  reply!: RestaurantReplyResponseDto | null;

  @ApiProperty({ example: '2026-07-26T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-26T12:00:00.000Z' })
  updatedAt!: string;
}

/** The restaurant's view adds the guest's private note, which is never published. */
export class StaffReviewResponseDto extends ReviewResponseDto {
  @ApiPropertyOptional({ example: 'The music was too loud near the door.', nullable: true })
  privateNote!: string | null;
}

export class StaffReviewListResponseDto {
  @ApiProperty({ type: [StaffReviewResponseDto] })
  items!: StaffReviewResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;
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
