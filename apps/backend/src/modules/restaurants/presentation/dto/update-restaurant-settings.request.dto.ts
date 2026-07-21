import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * Full-replace semantics, matching `UpdateRestaurantRequestDto`'s established
 * convention - every field required except `defaultCurrency`, which is
 * nullable in the domain. Bounds mirror `RestaurantSettings`'s own
 * `validate()` function exactly.
 */
export class UpdateRestaurantSettingsRequestDto {
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

  @ApiProperty({
    example: 90,
    minimum: 15,
    maximum: 480,
    description:
      'Fallback used to derive Reservation.reservationEndTime whenever the client omits it (Phase 7.1 architecture decision).',
  })
  @IsInt()
  @Min(15)
  @Max(480)
  defaultReservationDurationMinutes!: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  autoApproval!: boolean;

  @ApiProperty({ example: 'UTC' })
  @IsString()
  @IsNotEmpty()
  timezone!: string;

  @ApiPropertyOptional({ example: null, nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'defaultCurrency must be a three-letter ISO 4217 code' })
  defaultCurrency?: string | null;
}
