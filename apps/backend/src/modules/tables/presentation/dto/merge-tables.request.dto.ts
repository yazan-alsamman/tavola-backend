import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsOptional, IsUUID } from 'class-validator';

export class MergeTablesRequestDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 2,
    description:
      'At least 2 distinct Table ids to merge (ADR-026 decision #5) - must all belong to the same Branch and FloorPlan, be currently Available, and not already part of a merge group.',
  })
  @IsArray()
  @ArrayMinSize(2)
  @IsUUID('4', { each: true })
  tableIds!: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional - must be one of tableIds. When omitted, the Primary is derived automatically (lowest tableNumber, then Table.id ascending - ADR-026 decision #1/#5).',
  })
  @IsOptional()
  @IsUUID()
  primaryTableId?: string;
}
