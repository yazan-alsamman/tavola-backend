import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TableShape } from '@modules/tables/domain/enums/table.enums';

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D11): the
 * customer-safe public projection of a Table - deliberately NOT the internal
 * Owner/Admin `TableResponseDto` (which the pre-Phase-15.5 floor-plan
 * endpoint reused verbatim, over-exposing internal fields). Contains only
 * what a Customer genuinely needs to render/browse a floor plan and select a
 * table by size/location preference.
 *
 * Explicitly excluded (see `TASKS.md`'s Phase 15.5 decision note, D11, for
 * the full rationale): `mergeGroupId`/`isMergePrimary` (Merge/Split topology,
 * ADR-026, staff-only), `status` (live operational state - out of scope per
 * D8, and would leak real-time occupancy publicly with no browsing purpose),
 * `branchId` (redundant with the URL/parent FloorPlan), `createdAt`/
 * `updatedAt` (internal audit metadata, no customer value).
 *
 * ADR-040 adds `floorPlanAreaId` and `color` - both pure presentation metadata,
 * exactly like the `shape`/position/dimension fields already here, and both
 * required for a customer-facing seating chart to render the same grouping the
 * staff editor shows. Neither exposes operational state: the area is a static
 * part of the layout, not a live status.
 */
export class TablePublicResponseDto {
  @ApiProperty({ format: 'uuid' })
  tableId!: string;

  @ApiProperty({ format: 'uuid' })
  floorPlanId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'ADR-040: the dining area of this floor plan the table sits in, or null when it sits on the layout itself. Always one of the ids in the accompanying `areas` list.',
  })
  floorPlanAreaId!: string | null;

  @ApiProperty({ example: 'T1' })
  tableNumber!: string;

  @ApiProperty({ example: 4 })
  capacity!: number;

  @ApiProperty({ enum: TableShape })
  shape!: TableShape;

  @ApiPropertyOptional({
    example: '#F97316',
    nullable: true,
    description:
      'ADR-040: per-table color override (#RRGGBB), or null to inherit the color of its area. Presentation metadata only - it carries no operational meaning.',
  })
  color!: string | null;

  @ApiPropertyOptional({ example: 1, nullable: true })
  floor!: number | null;

  @ApiPropertyOptional({ example: 10.5, nullable: true })
  positionX!: number | null;

  @ApiPropertyOptional({ example: 20.5, nullable: true })
  positionY!: number | null;

  @ApiPropertyOptional({ example: 100, nullable: true })
  width!: number | null;

  @ApiPropertyOptional({ example: 100, nullable: true })
  height!: number | null;

  @ApiPropertyOptional({ example: 0, nullable: true })
  rotation!: number | null;

  @ApiPropertyOptional({ example: 0, nullable: true })
  layer!: number | null;

  @ApiProperty({ example: true })
  indoor!: boolean;

  @ApiProperty({ example: false })
  vip!: boolean;

  @ApiProperty({ example: false })
  smoking!: boolean;
}
