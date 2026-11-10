import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { FloorPlanAreaFeature } from '../../domain/enums/table.enums';
import { IsHexColor6 } from '../decorators/is-hex-color.decorator';

/**
 * ADR-040. `floorPlanId` is not a body field - it comes from the route, which
 * is where the tenant chain was already verified.
 */
export class CreateFloorPlanAreaRequestDto {
  @ApiProperty({
    example: 'Main Hall',
    description:
      'Unique among the non-deleted areas of this floor plan. Trimmed before storage, so "Main Hall" and "Main Hall " are the same name.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @ApiProperty({
    example: '#14B8A6',
    description:
      'Presentation color used to group this area visually. Exactly #RRGGBB (shorthand and alpha forms are rejected); stored uppercase.',
  })
  @IsString()
  @IsHexColor6()
  color!: string;

  @ApiPropertyOptional({
    example: 0,
    default: 0,
    minimum: 0,
    description:
      'Tab order in the floor editor, ascending. Not unique - equal values are ordered by creation time.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    enum: FloorPlanAreaFeature,
    isArray: true,
    example: ['Family', 'Outdoor'],
    description: 'ADR-044: what guests get in this area. Omitted = none.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsEnum(FloorPlanAreaFeature, { each: true })
  features?: FloorPlanAreaFeature[];

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    example: 0,
    description: 'Floor (null = ground floor). Omitted = none.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  floor?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    example: 0,
    description:
      'Rectangle on the grid (positionX, positionY, width, height), same units as table positions. Send all four or none. Omitted = none.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  positionX?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  positionY?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1, example: 480 })
  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 1, example: 320 })
  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number | null;
}
