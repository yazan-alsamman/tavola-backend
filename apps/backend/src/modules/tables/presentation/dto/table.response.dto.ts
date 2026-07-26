import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';

export class TableResponseDto {
  @ApiProperty({ format: 'uuid' })
  tableId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  floorPlanId!: string;

  @ApiProperty({ example: 'T1' })
  tableNumber!: string;

  @ApiProperty({ example: 4 })
  capacity!: number;

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

  @ApiProperty({ enum: TableShape })
  shape!: TableShape;

  @ApiPropertyOptional({ example: 0, nullable: true })
  layer!: number | null;

  @ApiProperty({ example: true })
  indoor!: boolean;

  @ApiProperty({ example: false })
  vip!: boolean;

  @ApiProperty({ example: false })
  smoking!: boolean;

  @ApiProperty({
    enum: TableStatus,
    description:
      'Status Management architecture decision: transitioned only via POST /tables/:tableId/status, restricted to Available <-> Occupied/Cleaning/Disabled. Reserved is not part of this enum (exclusively a Reservation Engine concept, deferred until that architecture is approved and frozen).',
  })
  status!: TableStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      "Phase 6 (Merge/Split Tables, ADR-026): the shared identifier of this table's active merge group, or null when not currently merged.",
  })
  mergeGroupId!: string | null;

  @ApiProperty({
    example: false,
    description:
      "Phase 6 (Merge/Split Tables, ADR-026): true only for the Primary of an active merge group - Reservation.tableId for the merged unit is always the primary's id. Always false when mergeGroupId is null.",
  })
  isMergePrimary!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
