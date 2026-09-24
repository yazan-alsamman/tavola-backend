import { ApiProperty } from '@nestjs/swagger';

/**
 * ADR-040 - the customer-safe public projection of a FloorPlanArea (the
 * concurrent halls of one layout: "Main Hall", "Guests", ...). Carries only
 * what a seating chart needs to render the same grouping the staff editor
 * shows: which areas exist, how they are colored, and in what order they are
 * presented.
 *
 * Excluded on the same Phase 15.5 D11 grounds as the surrounding projections:
 * `floorPlanId` (redundant with the enclosing `floorPlan`) and
 * `createdAt`/`updatedAt` (internal audit metadata, no customer value). Nothing
 * operational exists on this entity to leak - an Area has no status, no
 * occupancy and no merge topology.
 */
export class FloorPlanAreaPublicResponseDto {
  @ApiProperty({ format: 'uuid' })
  floorPlanAreaId!: string;

  @ApiProperty({ example: 'Main Hall' })
  name!: string;

  @ApiProperty({ example: '#14B8A6', description: 'Uppercase #RRGGBB.' })
  color!: string;

  @ApiProperty({ example: 0, description: 'Presentation order, ascending.' })
  sortOrder!: number;
}
