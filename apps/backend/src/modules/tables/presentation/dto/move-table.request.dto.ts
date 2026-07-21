import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class MoveTableRequestDto {
  @ApiProperty({
    format: 'uuid',
    description:
      "Must reference a FloorPlan already belonging to this Table's own branch and not soft-deleted (Phase 6.2 architecture decision).",
  })
  @IsUUID()
  targetFloorPlanId!: string;
}
