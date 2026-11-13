import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

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

  @ApiPropertyOptional({
    example: 6,
    nullable: true,
    minimum: 1,
    maximum: 100,
    description:
      'ADR-053: auto-approval applies only up to this party size. null = any size; omitted keeps the stored value.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  autoApprovalMaxGuests?: number | null;

  @ApiPropertyOptional({
    example: 60,
    minimum: 0,
    maximum: 10080,
    description: 'ADR-053: online bookings must start at least this many minutes from now.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  minLeadTimeMinutes?: number;

  @ApiPropertyOptional({
    example: 30,
    nullable: true,
    minimum: 1,
    maximum: 90,
    description: 'ADR-053: furthest day ahead to book online. null = the platform limit (90).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  maxDaysAhead?: number | null;

  @ApiPropertyOptional({
    example: 200,
    nullable: true,
    minimum: 1,
    maximum: 100000,
    description: 'ADR-053: most guests accepted online on one day. null = no cap.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  dailyGuestCap?: number | null;
}
