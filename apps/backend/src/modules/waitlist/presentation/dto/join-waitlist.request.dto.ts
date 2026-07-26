import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ReservationGuestRequestDto } from '@modules/reservations/presentation/dto/reservation-guest.request.dto';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

/**
 * Phase 7.5 architecture freeze item 1, refined by the final promotion-slot-
 * semantics decision (2026-07-24): `preferredDate` AND `preferredTimeFrom`
 * are both required at this API boundary - `preferredTimeFrom` is the
 * authoritative requested Reservation start time-of-day on promotion, no
 * longer a merely "soft" preference. `preferredTimeTo` remains optional and
 * non-authoritative (filtering metadata only). `reservationGuest` is
 * reachable only by an Employee actor holding `reservations:waitlist` for
 * the target branch (mirrors `CreateReservationRequestDto.reservationGuest`
 * exactly) - a Customer actor always joins for themselves, ignoring this
 * field.
 */
export class JoinWaitlistRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ example: 4, minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  partySize!: number;

  @ApiProperty({ format: 'date', example: '2026-08-01' })
  @IsDateString({ strict: true })
  preferredDate!: string;

  @ApiProperty({
    example: '19:00',
    description: 'HH:mm or HH:mm:ss, interpreted in the target Branch.timezone.',
  })
  @IsString()
  @Matches(TIME_PATTERN)
  preferredTimeFrom!: string;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    description: 'Optional, non-authoritative - never used to construct a Reservation.',
  })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN)
  preferredTimeTo?: string;

  @ApiPropertyOptional({ example: null, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiPropertyOptional({
    type: ReservationGuestRequestDto,
    description:
      'The guest to join on behalf of - reachable only by an Employee actor holding reservations:waitlist for the target branch; ignored (and the actor joins for themselves) otherwise.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReservationGuestRequestDto)
  reservationGuest?: ReservationGuestRequestDto;
}
