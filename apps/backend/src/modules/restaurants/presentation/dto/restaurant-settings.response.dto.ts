import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RestaurantSettingsResponseDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  restaurantId!: string;

  @ApiProperty({ example: 30, minimum: 5, maximum: 240 })
  reservationIntervalMinutes!: number;

  @ApiProperty({ example: 20, minimum: 1, maximum: 100 })
  maxGuestsPerReservation!: number;

  @ApiProperty({ example: 60, minimum: 0, maximum: 10080 })
  cancellationWindowMinutes!: number;

  @ApiProperty({ example: 15, minimum: 1, maximum: 1440 })
  pendingReservationTimeoutMinutes!: number;

  @ApiProperty({ example: 90, minimum: 15, maximum: 480 })
  defaultReservationDurationMinutes!: number;

  @ApiProperty({ example: false })
  autoApproval!: boolean;

  @ApiProperty({ example: 'UTC' })
  timezone!: string;

  @ApiPropertyOptional({ example: null, nullable: true })
  defaultCurrency!: string | null;

  @ApiProperty({ example: 60, minimum: 1, maximum: 10080 })
  reservationReminderMinutesBefore!: number;

  @ApiProperty({ example: 15, minimum: 1, maximum: 1440 })
  lateArrivalGraceMinutes!: number;

  @ApiProperty({ example: '2026-07-16T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-16T12:00:00.000Z' })
  updatedAt!: string;
}
