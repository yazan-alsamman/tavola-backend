import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';
import { ReservationGuestRequestDto } from './reservation-guest.request.dto';

/**
 * Phase 7.4 (decision #1/#3): `source` is optional - omitted, it resolves to
 * `Online` at the application boundary (backward-compatible with the
 * existing Customer flow). Only `Online`/`Phone`/`WalkIn` are reachable
 * through this endpoint - `Staff`/`WaitlistConversion` are internal-only
 * `ReservationSource` values with no client-facing creation path. Which
 * `source` values a given actor may actually reach is enforced in the
 * application layer from the actor's own verified type, never trusted from
 * this payload alone.
 */
const CLIENT_REACHABLE_SOURCES = [
  ReservationSource.Online,
  ReservationSource.Phone,
  ReservationSource.WalkIn,
] as const;

export class CreateReservationRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  tableId!: string;

  @ApiProperty({ format: 'date-time', example: '2026-08-01T18:00:00.000Z' })
  @IsDateString()
  reservationStartTime!: string;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description:
      "Validated then persisted if supplied. If omitted, the backend derives it from the Restaurant's default reservation duration (Phase 7.1 architecture decision) - the backend is the single source of truth for the final persisted value either way.",
  })
  @IsOptional()
  @IsDateString()
  reservationEndTime?: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  guests!: number;

  @ApiPropertyOptional({ example: null, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiPropertyOptional({
    enum: CLIENT_REACHABLE_SOURCES,
    default: ReservationSource.Online,
    description:
      'Omitted resolves to Online. Phone/WalkIn are reachable only by an Employee actor holding reservations:create for the target branch (Phase 7.4) - a Customer actor may never reach either, regardless of what this field is set to.',
  })
  @IsOptional()
  @IsIn(CLIENT_REACHABLE_SOURCES)
  source?: ReservationSource;

  @ApiPropertyOptional({
    type: ReservationGuestRequestDto,
    description:
      'Required when source is Phone or WalkIn (the party the reservation is for, when no registered User account exists); ignored otherwise.',
  })
  @ValidateIf(
    (dto: CreateReservationRequestDto) =>
      dto.source === ReservationSource.Phone || dto.source === ReservationSource.WalkIn,
  )
  @IsDefined()
  @ValidateNested()
  @Type(() => ReservationGuestRequestDto)
  reservationGuest?: ReservationGuestRequestDto;
}
