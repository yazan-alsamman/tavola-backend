import { ApiProperty } from '@nestjs/swagger';

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D11): the
 * customer-safe public projection of a FloorPlan - excludes `isActive` (
 * implied by being the one FloorPlan this endpoint ever returns) and
 * `createdAt`/`updatedAt` (internal audit metadata, no customer value). See
 * `TablePublicResponseDto` for the accompanying Table projection.
 */
export class FloorPlanPublicResponseDto {
  @ApiProperty({ format: 'uuid' })
  floorPlanId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: 'Main Floor' })
  name!: string;
}
