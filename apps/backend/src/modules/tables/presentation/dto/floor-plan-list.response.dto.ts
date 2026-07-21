import { ApiProperty } from '@nestjs/swagger';
import { FloorPlanResponseDto } from './floor-plan.response.dto';

export class FloorPlanListResponseDto {
  @ApiProperty({ type: [FloorPlanResponseDto] })
  items!: FloorPlanResponseDto[];
}
