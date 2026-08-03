import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D15/D18):
 * Comparison API per ADR-018 §"Comparison API" - 2-5 unique restaurant ids,
 * stateless, no persistence. Mirrors `MergeTablesRequestDto`'s exact array
 * validation pattern.
 */
export class CompareRestaurantsRequestDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 2,
    maxItems: 5,
    description: '2-5 unique Restaurant ids to compare (ADR-018 Comparison API).',
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  restaurantIds!: string[];
}
