import { ApiProperty } from '@nestjs/swagger';
import { CuisineCategoryResponseDto } from '@modules/restaurants/presentation/dto/cuisine-category.response.dto';
import { OccasionCategoryResponseDto } from '@modules/restaurants/presentation/dto/occasion-category.response.dto';

export class BranchCategoriesResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ type: [CuisineCategoryResponseDto] })
  cuisineCategories!: CuisineCategoryResponseDto[];

  @ApiProperty({ type: [OccasionCategoryResponseDto] })
  occasionCategories!: OccasionCategoryResponseDto[];
}
