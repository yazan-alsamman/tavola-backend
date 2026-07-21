import { OccasionCategory } from '../../domain/entities/occasion-category.entity';
import { OccasionCategoryResult } from '../dto/occasion-category.result';

export function toOccasionCategoryResult(category: OccasionCategory): OccasionCategoryResult {
  return {
    occasionCategoryId: category.occasionCategoryId,
    slug: category.slug,
    name: category.name,
    sortOrder: category.sortOrder,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}
