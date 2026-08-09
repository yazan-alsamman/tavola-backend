import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Public Working Hours (customer-facing correction). The customer-safe
 * projection of one weekly-schedule row, shared by both the Restaurant-level
 * default (`WorkingHours`, Phase 4.3) and the Branch-level override
 * (`BranchWorkingHours`, Phase 5.2) - both entities are structurally
 * identical (`dayOfWeek`/`openingTime`/`closingTime`/`breakStartTime`/
 * `breakEndTime`), so one shared public DTO avoids a pointless duplicate
 * class. `createdAt`/`updatedAt` are deliberately excluded - internal audit
 * metadata, no customer value, matching `FloorPlanPublicResponseDto`'s own
 * precedent (D11).
 */
export class WorkingHoursEntryPublicResponseDto {
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
}
