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

export class CreateTableRequestDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Every Table belongs to exactly one FloorPlan (Phase 6.1 architecture decision).',
  })
  @IsUUID()
  floorPlanId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'ADR-040 - the dining area (hall) inside this floor plan the table is placed in. Must be a live area of THAT SAME floor plan; null (or omitted) places the table on the layout itself, in no named area.',
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
      'Presentation metadata only (Phase 6.1 architecture decision) - no bearing on reservation rules, capacity, or merge/split. A square table is Rectangle with width == height.',
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
