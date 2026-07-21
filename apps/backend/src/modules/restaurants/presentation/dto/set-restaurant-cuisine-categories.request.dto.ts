import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * Full-replace semantics, matching `UpdateWorkingHoursRequestDto`'s
 * established convention: `cuisineCategoryIds` becomes the restaurant's
 * entire cuisine assignment - an id not present is unassigned.
 * `ArrayMaxSize(50)` is a defensive payload-size bound, not a business rule
 * (the seeded catalog is far smaller).
 */
export class SetRestaurantCuisineCategoriesRequestDto {
  @ApiProperty({
    type: [String],
    example: ['11111111-1111-4111-8111-111111111111'],
    description: 'Ids of active CuisineCategory rows (see GET /cuisine-categories)',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  cuisineCategoryIds!: string[];
}
