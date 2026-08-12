import { ApiProperty } from '@nestjs/swagger';

export class RestaurantStatsResponseDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  active!: number;

  @ApiProperty()
  suspended!: number;

  @ApiProperty()
  deleted!: number;
}

export class OrganizationStatsResponseDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  active!: number;

  @ApiProperty()
  suspended!: number;

  @ApiProperty()
  deleted!: number;
}

export class SubscriptionStatsResponseDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  active!: number;

  @ApiProperty()
  suspended!: number;

  @ApiProperty()
  cancelled!: number;

  @ApiProperty()
  expired!: number;
}

export class AcquisitionCurrencySummaryResponseDto {
  @ApiProperty()
  currency!: string;

  @ApiProperty()
  recordedCount!: number;

  @ApiProperty()
  recordedTotal!: number;

  @ApiProperty()
  reversedCount!: number;

  @ApiProperty()
  reversedTotal!: number;
}

export class AcquisitionSummaryResponseDto {
  @ApiProperty()
  from!: string;

  @ApiProperty()
  to!: string;

  @ApiProperty({ type: [AcquisitionCurrencySummaryResponseDto] })
  currencies!: AcquisitionCurrencySummaryResponseDto[];
}

export class MessagingStatsResponseDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  notAttempted!: number;

  @ApiProperty()
  queued!: number;

  @ApiProperty()
  accepted!: number;

  @ApiProperty()
  failed!: number;
}

export class PlatformDashboardResponseDto {
  @ApiProperty()
  generatedAt!: string;

  @ApiProperty({ type: RestaurantStatsResponseDto })
  restaurants!: RestaurantStatsResponseDto;

  @ApiProperty({ type: OrganizationStatsResponseDto })
  organizations!: OrganizationStatsResponseDto;

  @ApiProperty({ type: SubscriptionStatsResponseDto })
  subscriptions!: SubscriptionStatsResponseDto;

  @ApiProperty({ type: AcquisitionSummaryResponseDto })
  acquisition!: AcquisitionSummaryResponseDto;

  @ApiProperty({ type: MessagingStatsResponseDto })
  messaging!: MessagingStatsResponseDto;
}
