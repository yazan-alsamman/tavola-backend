import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class MoveTableRequestDto {
  @ApiProperty({
    format: 'uuid',
    description:
      "Must reference a FloorPlan already belonging to this Table's own branch and not soft-deleted (Phase 6.2 architecture decision).",
  })
  @IsUUID()
  targetFloorPlanId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'ADR-040 - the dining area inside the TARGET floor plan the table lands in. Must be a live area of the target plan. Omit (or send null) to land on the target layout with no area. The source plan area is never carried over, because an area belongs to exactly one floor plan.',
  })
  @IsOptional()
  @IsUUID()
  targetFloorPlanAreaId?: string | null;
}
