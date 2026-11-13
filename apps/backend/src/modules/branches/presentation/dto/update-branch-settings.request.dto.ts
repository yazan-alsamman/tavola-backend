import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';

/** ADR-051: a branch's reservation rules (full replace). Same bounds as restaurant settings. */
export class UpdateBranchSettingsRequestDto {
  @ApiProperty({ example: 30, minimum: 5, maximum: 240 })
  @IsInt()
  @Min(5)
  @Max(240)
  reservationIntervalMinutes!: number;

  @ApiProperty({ example: 20, minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  maxGuestsPerReservation!: number;

  @ApiProperty({ example: 60, minimum: 0, maximum: 10080 })
  @IsInt()
  @Min(0)
  @Max(10080)
  cancellationWindowMinutes!: number;

  @ApiProperty({ example: 15, minimum: 1, maximum: 1440 })
  @IsInt()
  @Min(1)
  @Max(1440)
  pendingReservationTimeoutMinutes!: number;

  @ApiProperty({ example: 90, minimum: 15, maximum: 480 })
  @IsInt()
  @Min(15)
  @Max(480)
  defaultReservationDurationMinutes!: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  autoApproval!: boolean;

  @ApiProperty({ example: 60, minimum: 1, maximum: 10080 })
  @IsInt()
  @Min(1)
  @Max(10080)
  reservationReminderMinutesBefore!: number;

  @ApiProperty({ example: 15, minimum: 1, maximum: 1440 })
  @IsInt()
  @Min(1)
  @Max(1440)
  lateArrivalGraceMinutes!: number;
}
