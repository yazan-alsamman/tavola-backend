import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class SearchAvailabilityQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-08-01T18:00:00.000Z',
    description:
      'Window start. Combined with reservationEndTime (or the derived duration) to check each table for an overlapping Pending/Approved reservation.',
  })
  @IsDateString()
  reservationStartTime!: string;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description:
      "Window end. When omitted, derived from the branch restaurant's default reservation duration (Phase 7.1 architecture decision) - identical to Create Reservation's own derivation rule.",
  })
  @IsOptional()
  @IsDateString()
  reservationEndTime?: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  partySize!: number;
}
