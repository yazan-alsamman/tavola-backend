import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkingHoursEntryPublicResponseDto } from './working-hours-entry-public.response.dto';

/**
 * Public Working Hours & Restaurant Phone Privacy (customer-facing
 * correction). The customer-safe projection of a Branch - every field
 * `BranchResponseDto` carries EXCEPT `phone` (private operational data,
 * never public/customer-facing - see this phase's own task instructions
 * §5/§9), plus `workingHours` (this branch's own override schedule,
 * `BranchWorkingHours`, Phase 5.2). A dedicated Discovery-only class, not
 * `BranchResponseDto` with a field removed (TypeScript extension can only
 * add fields) - same "customer-safe projection" precedent as
 * `FloorPlanPublicResponseDto`/`TablePublicResponseDto` (D11).
 */
export class BranchPublicResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ example: 'Damascus' })
  city!: string;

  @ApiPropertyOptional({ example: 'Malki', nullable: true })
  district!: string | null;

  @ApiProperty({ example: '123 Main St' })
  address!: string;

  @ApiPropertyOptional({ example: 33.5138, nullable: true })
  latitude!: number | null;

  @ApiPropertyOptional({ example: 36.2765, nullable: true })
  longitude!: number | null;

  @ApiProperty({ example: 'SY' })
  countryCode!: string;

  @ApiPropertyOptional({ example: 'SYP', nullable: true })
  currency!: string | null;

  @ApiProperty({ example: 'Asia/Damascus' })
  timezone!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: [WorkingHoursEntryPublicResponseDto] })
  workingHours!: WorkingHoursEntryPublicResponseDto[];
}
