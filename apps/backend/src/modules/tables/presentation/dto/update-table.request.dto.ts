import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';
import { TableShape } from '@modules/tables/domain/enums/table.enums';
import { IsHexColor6 } from '../decorators/is-hex-color.decorator';

/**
 * Full-replace semantics, matching `UpdateBranchRequestDto`'s own convention.
 * Never accepts `floorPlanId` (Move Table is explicitly out of Phase 6.1
 * scope) or `status` (Phase 6.1 architecture decision: fixed to `Available`).
 *
 * ADR-040 - this is the floor editor's drag-to-save endpoint: the layout fields
 * (`positionX`/`positionY`/`width`/`height`/`rotation`/`shape`) and the new
 * `floorPlanAreaId`/`color` are all written in the same full-replace request.
 * Because the semantics are full-replace, an omitted optional field is written
 * as `null`, not left at its previous value - send the complete desired state.
 */
export class UpdateTableRequestDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'ADR-040 - the dining area (hall), inside this table’s own floor plan, that the table is placed in. Must be a live area of THAT SAME floor plan; null (or omitted) clears the assignment. Moving a table to another floor plan is POST /tables/:tableId/move, never this endpoint.',
  })
  @IsOptional()
  @IsUUID()
  floorPlanAreaId?: string | null;

  @ApiProperty({ example: 'T1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  tableNumber!: string;

  @ApiProperty({ example: 4, minimum: 1 })
  @IsInt()
  @Min(1)
  capacity!: number;

  @ApiPropertyOptional({ example: 1, nullable: true })
  @IsOptional()
  @IsInt()
  floor?: number | null;

  @ApiPropertyOptional({ example: 10.5, nullable: true })
  @IsOptional()
  @IsNumber()
  positionX?: number | null;

  @ApiPropertyOptional({ example: 20.5, nullable: true })
  @IsOptional()
  @IsNumber()
  positionY?: number | null;

  @ApiPropertyOptional({ example: 100, nullable: true })
  @IsOptional()
  @IsNumber()
  width?: number | null;

  @ApiPropertyOptional({ example: 100, nullable: true })
  @IsOptional()
  @IsNumber()
  height?: number | null;

  @ApiPropertyOptional({ example: 0, nullable: true })
  @IsOptional()
  @IsNumber()
  rotation?: number | null;

  @ApiPropertyOptional({
    enum: TableShape,
    default: TableShape.Rectangle,
    description:
      'Presentation metadata only (Phase 6.1 architecture decision) - a square table is Rectangle with width == height.',
  })
  @IsOptional()
  @IsEnum(TableShape)
  shape?: TableShape;

  @ApiPropertyOptional({
    example: '#F97316',
    nullable: true,
    description:
      "ADR-040 - per-table presentation override, exactly #RRGGBB (stored uppercase). null (or omitted) means the table inherits its area's color; it does not mean the table has no color.",
  })
  @IsOptional()
  @IsString()
  @IsHexColor6()
  color?: string | null;

  @ApiPropertyOptional({ example: 0, nullable: true })
  @IsOptional()
  @IsInt()
  layer?: number | null;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  indoor?: boolean;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  vip?: boolean;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  smoking?: boolean;
}
