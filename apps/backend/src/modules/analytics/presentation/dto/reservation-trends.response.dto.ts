import { ApiProperty } from '@nestjs/swagger';

class DayBucketDto {
  @ApiProperty({ example: '2026-07-21' }) date!: string;
  @ApiProperty({ example: 4 }) count!: number;
}

export class ReservationTrendsResponseDto {
  @ApiProperty({ type: [DayBucketDto], description: 'Branch-local calendar day, zero-filled' })
  serviceDayTrend!: DayBucketDto[];

  @ApiProperty({ type: [DayBucketDto], description: 'Branch-local calendar day, zero-filled' })
  bookingCreatedTrend!: DayBucketDto[];

  @ApiProperty({ example: '2026-07-28T12:00:00.000Z' }) generatedAt!: string;
}
