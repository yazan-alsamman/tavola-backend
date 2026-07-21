import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BranchWorkingHoursEntryResponseDto {
  @ApiProperty({ example: 1, minimum: 0, maximum: 6, description: '0=Sunday..6=Saturday' })
  dayOfWeek!: number;

  @ApiProperty({ example: '09:00' })
  openingTime!: string;

  @ApiProperty({ example: '22:00' })
  closingTime!: string;

  @ApiPropertyOptional({ example: null, nullable: true })
  breakStartTime!: string | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  breakEndTime!: string | null;

  @ApiProperty({ example: '2026-07-16T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-16T12:00:00.000Z' })
  updatedAt!: string;
}

export class BranchWorkingHoursResponseDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  branchId!: string;

  @ApiProperty({ type: [BranchWorkingHoursEntryResponseDto] })
  entries!: BranchWorkingHoursEntryResponseDto[];
}
