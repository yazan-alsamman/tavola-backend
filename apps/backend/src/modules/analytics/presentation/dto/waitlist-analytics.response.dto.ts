import { ApiProperty } from '@nestjs/swagger';

class WaitlistStatusCountsDto {
  @ApiProperty({ example: 4 }) Waiting!: number;
  @ApiProperty({ example: 1 }) Notified!: number;
  @ApiProperty({ example: 10 }) Converted!: number;
  @ApiProperty({ example: 3 }) Cancelled!: number;
  @ApiProperty({ example: 2 }) Expired!: number;
}

export class WaitlistAnalyticsResponseDto {
  @ApiProperty({ type: WaitlistStatusCountsDto }) waitlistEntries!: WaitlistStatusCountsDto;

  @ApiProperty({
    example: 0.6667,
    nullable: true,
    description:
      'Converted / (Converted + Cancelled + Expired); Waiting/Notified excluded; null if denominator is 0',
  })
  waitlistConversionRate!: number | null;

  @ApiProperty({ example: '2026-07-28T12:00:00.000Z' }) generatedAt!: string;
}
