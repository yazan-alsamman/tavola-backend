import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { IsHexColor6 } from '../decorators/is-hex-color.decorator';

/**
 * ADR-040. Full-replace semantics, matching `UpdateTableRequestDto`'s own
 * convention. Never accepts `floorPlanId` - an Area cannot migrate between
 * layouts (see `FloorPlanArea.updateProfile`).
 */
export class UpdateFloorPlanAreaRequestDto {
  @ApiProperty({
    example: 'Main Hall',
    description: 'Unique among the non-deleted areas of this floor plan.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @ApiProperty({
    example: '#14B8A6',
    description: 'Exactly #RRGGBB; stored uppercase.',
  })
  @IsString()
  @IsHexColor6()
  color!: string;

  @ApiPropertyOptional({
    example: 0,
    default: 0,
    minimum: 0,
    description: 'Tab order in the floor editor, ascending.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
