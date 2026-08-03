import { ApiProperty } from '@nestjs/swagger';

export class ReviewsSummaryResponseDto {
  @ApiProperty({ example: 87 }) activeReviewCount!: number;
  @ApiProperty({ example: 4.32, nullable: true }) averageRating!: number | null;
  @ApiProperty({ example: '2026-07-28T12:00:00.000Z' }) generatedAt!: string;
}
