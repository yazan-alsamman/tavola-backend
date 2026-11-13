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

  @ApiProperty({ example: '2026-11-13T12:00:00.000Z' })
  updatedAt!: string;
}
