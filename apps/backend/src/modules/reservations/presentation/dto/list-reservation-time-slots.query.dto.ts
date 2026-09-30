import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

export class ListReservationTimeSlotsQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({
    example: '2026-09-30',
    description: 'Calendar date in the branch timezone (YYYY-MM-DD).',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @ApiProperty({ example: 4, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  partySize!: number;

  @ApiPropertyOptional({
    example: 120,
    minimum: 15,
    maximum: 480,
    description:
      'Reservation length in minutes. When omitted, the restaurant defaultReservationDurationMinutes is used. The interval between starts is never taken from the client.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(480)
  durationMinutes?: number;
}
