import { ApiProperty } from '@nestjs/swagger';
import { FloorPlanResponseDto } from '@modules/tables/presentation/dto/floor-plan.response.dto';
import { TableResponseDto } from '@modules/tables/presentation/dto/table.response.dto';

export class FloorPlanWithTablesResponseDto {
  @ApiProperty({ type: FloorPlanResponseDto })
  floorPlan!: FloorPlanResponseDto;

  @ApiProperty({ type: [TableResponseDto] })
  tables!: TableResponseDto[];
}
