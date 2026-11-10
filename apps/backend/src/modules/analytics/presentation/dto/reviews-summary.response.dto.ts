import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { REVIEW_AXES, ReviewAxis } from '@modules/reviews/domain/entities/review.entity';

export class ReviewAxisAveragesResponseDto {
  @ApiPropertyOptional({ example: 4.5, nullable: true }) service!: number | null;
  @ApiPropertyOptional({ example: 4.8, nullable: true }) place!: number | null;
  @ApiPropertyOptional({ example: 4.1, nullable: true }) food!: number | null;
}

export class ReviewsSummaryResponseDto {
  @ApiProperty({ example: 87, description: 'Every active review, all time.' })
  activeReviewCount!: number;

  @ApiPropertyOptional({
    example: 4.32,
    nullable: true,
    description: 'Real average score of the last 6 months; null with no reviews there.',
  })
  averageRating!: number | null;

  @ApiProperty({ example: 23, description: 'Active reviews in the last 6 months.' })
  windowReviewCount!: number;

  @ApiProperty({
    example: false,
    description: 'Fewer than 5 reviews in the window: guests see "new on Tavola" instead of stars.',
  })
  isNew!: boolean;

  @ApiProperty({ type: ReviewAxisAveragesResponseDto })
  axisAverages!: ReviewAxisAveragesResponseDto;

  @ApiPropertyOptional({ enum: REVIEW_AXES, nullable: true, example: 'place' })
  strongestAxis!: ReviewAxis | null;

  @ApiPropertyOptional({ enum: REVIEW_AXES, nullable: true, example: 'food' })
  weakestAxis!: ReviewAxis | null;

  @ApiProperty({ example: '2026-07-28T12:00:00.000Z' }) generatedAt!: string;
}
