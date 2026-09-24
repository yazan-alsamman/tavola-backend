import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
