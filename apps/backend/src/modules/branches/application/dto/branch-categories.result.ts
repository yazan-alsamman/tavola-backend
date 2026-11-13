import { CuisineCategoryResult } from '@modules/restaurants/application/dto/cuisine-category.result';
import { OccasionCategoryResult } from '@modules/restaurants/application/dto/occasion-category.result';

export interface BranchCategoriesResult {
  branchId: string;
  cuisineCategories: CuisineCategoryResult[];
  occasionCategories: OccasionCategoryResult[];
}
