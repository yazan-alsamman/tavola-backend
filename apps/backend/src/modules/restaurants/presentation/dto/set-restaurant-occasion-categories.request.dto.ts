import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * Full-replace semantics, matching `UpdateWorkingHoursRequestDto`'s
 * established convention: `occasionCategoryIds` becomes the restaurant's
 * entire occasion assignment - an id not present is unassigned.
 * `ArrayMaxSize(50)` is a defensive payload-size bound, not a business rule
 * (the seeded catalog is far smaller).
 */
export class SetRestaurantOccasionCategoriesRequestDto {
  @ApiProperty({
    type: [String],
    example: ['22222222-2222-4222-8222-222222222222'],
    description: 'Ids of active OccasionCategory rows (see GET /occasion-categories)',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  occasionCategoryIds!: string[];
}
