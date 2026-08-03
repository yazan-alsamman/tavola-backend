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
 */
export class TablePublicResponseDto {
  @ApiProperty({ format: 'uuid' })
  tableId!: string;

  @ApiProperty({ format: 'uuid' })
  floorPlanId!: string;

  @ApiProperty({ example: 'T1' })
  tableNumber!: string;

  @ApiProperty({ example: 4 })
  capacity!: number;

  @ApiProperty({ enum: TableShape })
  shape!: TableShape;

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
