import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * All fields are optional - any omitted field retains its current value.
 * The use case rejects the request if every field is omitted (nothing to
 * reschedule). `tableId` may target another Table within the same Branch
 * only (Phase 7.3 architecture decision) - cross-Branch targets are rejected
 * as not found, matching Move Table's own precedent.
 */
export class RescheduleReservationRequestDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  tableId?: string;

  @ApiPropertyOptional({ format: 'date-time', example: '2026-08-01T19:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  reservationStartTime?: string;

  @ApiPropertyOptional({ format: 'date-time', example: '2026-08-01T20:30:00.000Z' })
  @IsOptional()
  @IsDateString()
  reservationEndTime?: string;

  @ApiPropertyOptional({ example: 2, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  guests?: number;
}
