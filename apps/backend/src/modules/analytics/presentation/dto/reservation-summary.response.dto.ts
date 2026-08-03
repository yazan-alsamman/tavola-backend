import { ApiProperty } from '@nestjs/swagger';

class ReservationStatusCountsDto {
  @ApiProperty({ example: 12 }) Pending!: number;
  @ApiProperty({ example: 40 }) Approved!: number;
  @ApiProperty({ example: 3 }) Rejected!: number;
  @ApiProperty({ example: 6 }) Cancelled!: number;
  @ApiProperty({ example: 30 }) Completed!: number;
  @ApiProperty({ example: 1 }) Expired!: number;
  @ApiProperty({ example: 2 }) NoShow!: number;
}

class ReservationSourceBreakdownDto {
  @ApiProperty({ example: 50 }) Online!: number;
  @ApiProperty({ example: 10 }) Phone!: number;
  @ApiProperty({ example: 15 }) WalkIn!: number;
  @ApiProperty({ example: 5 }) Staff!: number;
  @ApiProperty({ example: 2 }) WaitlistConversion!: number;
}

export class ReservationSummaryResponseDto {
  @ApiProperty({ type: ReservationStatusCountsDto }) statusCounts!: ReservationStatusCountsDto;
  @ApiProperty({ type: ReservationSourceBreakdownDto })
  sourceBreakdown!: ReservationSourceBreakdownDto;

  @ApiProperty({
    example: 0.9375,
    nullable: true,
    description: 'Completed / (Completed + NoShow); null if denominator is 0',
  })
  completionRate!: number | null;

  @ApiProperty({
    example: 0.0625,
    nullable: true,
    description: 'NoShow / (Completed + NoShow); null if denominator is 0',
  })
  noShowRate!: number | null;

  @ApiProperty({
    example: 0.1538,
    nullable: true,
    description:
      'Cancelled-from-Approved / (Cancelled-from-Approved + Completed + NoShow); null if denominator is 0',
  })
  cancellationRate!: number | null;

  @ApiProperty({ example: 2.4, nullable: true }) avgPartySize!: number | null;
  @ApiProperty({ example: '2026-07-28T12:00:00.000Z' }) generatedAt!: string;
}
