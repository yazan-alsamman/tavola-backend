import { ApiProperty } from '@nestjs/swagger';
import { FloorPlanPublicResponseDto } from './floor-plan-public.response.dto';
import { FloorPlanAreaPublicResponseDto } from './floor-plan-area-public.response.dto';
import { TablePublicResponseDto } from './table-public.response.dto';

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D11): as of
 * this phase, composed from the dedicated customer-safe
 * `FloorPlanPublicResponseDto`/`TablePublicResponseDto` projections, not the
 * internal Owner/Admin `FloorPlanResponseDto`/`TableResponseDto` this route
 * reused verbatim before the D11 correction - see those DTOs' own doc
 * comments for the exact excluded-field list and rationale.
 */
export class FloorPlanWithTablesResponseDto {
  @ApiProperty({ type: FloorPlanPublicResponseDto })
  floorPlan!: FloorPlanPublicResponseDto;

  @ApiProperty({
    type: [FloorPlanAreaPublicResponseDto],
    description:
      'ADR-040: the concurrent dining areas (halls) of this layout, ordered for presentation. Empty when the branch has not divided its layout into named areas - every table then sits on the layout itself and carries floorPlanAreaId: null.',
  })
  areas!: FloorPlanAreaPublicResponseDto[];

  @ApiProperty({ type: [TablePublicResponseDto] })
  tables!: TablePublicResponseDto[];
}
