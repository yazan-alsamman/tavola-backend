import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
}
