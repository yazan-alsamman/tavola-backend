import { ApiProperty } from '@nestjs/swagger';
import { FloorPlanAreaResponseDto } from './floor-plan-area.response.dto';

export class FloorPlanAreaListResponseDto {
  @ApiProperty({ type: [FloorPlanAreaResponseDto] })
  items!: FloorPlanAreaResponseDto[];
}
