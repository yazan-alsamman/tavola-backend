import { ApiProperty } from '@nestjs/swagger';

/** ADR-051: the reservation rules a branch uses. */
export class BranchSettingsResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: 30 })
  reservationIntervalMinutes!: number;

  @ApiProperty({ example: 20 })
  maxGuestsPerReservation!: number;

  @ApiProperty({ example: 60 })
  cancellationWindowMinutes!: number;

  @ApiProperty({ example: 15 })
  pendingReservationTimeoutMinutes!: number;

  @ApiProperty({ example: 90 })
  defaultReservationDurationMinutes!: number;

  @ApiProperty({ example: false })
  autoApproval!: boolean;

  @ApiProperty({ example: 60 })
  reservationReminderMinutesBefore!: number;

  @ApiProperty({ example: 15 })
  lateArrivalGraceMinutes!: number;

  @ApiProperty({
    example: 6,
    nullable: true,
    description: 'ADR-053: auto-approval only up to this party size; null means any size.',
  })
  autoApprovalMaxGuests!: number | null;

  @ApiProperty({
    example: 60,
    description: 'ADR-053: online bookings must start at least this many minutes from now.',
  })
  minLeadTimeMinutes!: number;

  @ApiProperty({
    example: 30,
    nullable: true,
    description: 'ADR-053: furthest day ahead to book online; null means the platform limit (90).',
  })
  maxDaysAhead!: number | null;

  @ApiProperty({
    example: 200,
    nullable: true,
    description: 'ADR-053: most guests accepted online on one day; null means no cap.',
  })
  dailyGuestCap!: number | null;

  @ApiProperty({ example: '2026-11-13T12:00:00.000Z' })
  updatedAt!: string;
}
