import { ApiProperty } from '@nestjs/swagger';

export class FloorPlanResponseDto {
  @ApiProperty({ format: 'uuid' })
  floorPlanId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: 'Main Floor' })
  name!: string;

  @ApiProperty({
    example: true,
    description:
      'At most one active FloorPlan per branch (Phase 6.1 Aggregate Invariant). The first FloorPlan of a branch becomes active automatically.',
  })
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
