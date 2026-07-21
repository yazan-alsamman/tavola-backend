import { CuisineCategory } from '../../domain/entities/cuisine-category.entity';
import { CuisineCategoryResult } from '../dto/cuisine-category.result';

export function toCuisineCategoryResult(category: CuisineCategory): CuisineCategoryResult {
  return {
    cuisineCategoryId: category.cuisineCategoryId,
    slug: category.slug,
    name: category.name,
    sortOrder: category.sortOrder,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}
