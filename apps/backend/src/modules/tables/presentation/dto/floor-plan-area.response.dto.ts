import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FloorPlanAreaFeature } from '../../domain/enums/table.enums';

export class FloorPlanAreaResponseDto {
  @ApiProperty({ format: 'uuid' })
  floorPlanAreaId!: string;

  @ApiProperty({ format: 'uuid' })
  floorPlanId!: string;

  @ApiProperty({ example: 'Main Hall' })
  name!: string;

  @ApiProperty({
    example: '#14B8A6',
    description: 'Normalized uppercase #RRGGBB. Presentation metadata only.',
  })
  color!: string;

  @ApiProperty({
    example: 0,
    description: 'Tab order, ascending; ties broken by createdAt ascending.',
  })
  sortOrder!: number;

  @ApiProperty({
    enum: FloorPlanAreaFeature,
    isArray: true,
    example: ['Family', 'Outdoor'],
    description: 'ADR-044: what guests get in this area; every table in it takes these on.',
  })
  features!: FloorPlanAreaFeature[];

  @ApiPropertyOptional({ nullable: true, example: 0, description: 'Floor (null = ground floor).' })
  floor!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 0,
    description: 'Rectangle on the grid, same units as table positions. All four null = not drawn.',
  })
  positionX!: number | null;

  @ApiPropertyOptional({ nullable: true, example: 0 })
  positionY!: number | null;

  @ApiPropertyOptional({ nullable: true, example: 480 })
  width!: number | null;

  @ApiPropertyOptional({ nullable: true, example: 320 })
  height!: number | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
