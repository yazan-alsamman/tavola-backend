import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { TableShape } from '@modules/tables/domain/enums/table.enums';

/**
 * Full-replace semantics, matching `UpdateBranchRequestDto`'s own convention.
 * Never accepts `floorPlanId` (Move Table is explicitly out of Phase 6.1
 * scope) or `status` (Phase 6.1 architecture decision: fixed to `Available`).
 */
export class UpdateTableRequestDto {
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
