import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/** ADR-051: full replace of one branch's cuisine and occasion assignments. */
export class SetBranchCategoriesRequestDto {
  @ApiProperty({ type: [String], format: 'uuid', description: 'Active cuisine category ids.' })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  cuisineCategoryIds!: string[];

  @ApiProperty({ type: [String], format: 'uuid', description: 'Active occasion category ids.' })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  occasionCategoryIds!: string[];
}
