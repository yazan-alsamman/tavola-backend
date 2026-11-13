import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { MAX_CLOSURE_REASON_LENGTH } from '../../domain/entities/branch-closure.entity';

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateBranchClosureRequestDto {
  @ApiProperty({ example: '2026-12-24', description: 'First closed day (branch local date)' })
  @IsString()
  @Matches(CALENDAR_DATE, { message: 'startDate must be YYYY-MM-DD' })
  startDate!: string;

  @ApiProperty({ example: '2026-12-26', description: 'Last closed day, inclusive' })
  @IsString()
  @Matches(CALENDAR_DATE, { message: 'endDate must be YYYY-MM-DD' })
  endDate!: string;

  @ApiPropertyOptional({ example: 'Renovation', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CLOSURE_REASON_LENGTH)
  reason?: string | null;
}

export class BranchClosureResponseDto {
  @ApiProperty({ format: 'uuid' })
  closureId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: '2026-12-24' })
  startDate!: string;

  @ApiProperty({ example: '2026-12-26' })
  endDate!: string;

  @ApiProperty({ example: 'Renovation', nullable: true })
  reason!: string | null;

  @ApiProperty({ example: '2026-11-14T10:00:00.000Z' })
  createdAt!: string;
}
