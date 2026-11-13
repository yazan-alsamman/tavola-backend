import { Injectable, Inject } from '@nestjs/common';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CuisineCategoryRepository,
  CUISINE_CATEGORY_REPOSITORY,
} from '@modules/restaurants/domain/repositories/cuisine-category.repository';
import {
  OccasionCategoryRepository,
  OCCASION_CATEGORY_REPOSITORY,
} from '@modules/restaurants/domain/repositories/occasion-category.repository';
import { toCuisineCategoryResult } from '@modules/restaurants/application/mappers/cuisine-category-result.mapper';
import { toOccasionCategoryResult } from '@modules/restaurants/application/mappers/occasion-category-result.mapper';
import {
  BranchCategoryRepository,
  BRANCH_CATEGORY_REPOSITORY,
} from '../../domain/repositories/branch-category.repository';
import { BranchCategoriesResult } from '../dto/branch-categories.result';

/** Loads a branch's assigned categories (ADR-051), sorted like the public lists. */
@Injectable()
export class BranchCategoriesReader {
  constructor(
    @Inject(BRANCH_CATEGORY_REPOSITORY)
    private readonly branchCategoryRepository: BranchCategoryRepository,
    @Inject(CUISINE_CATEGORY_REPOSITORY)
    private readonly cuisineCategoryRepository: CuisineCategoryRepository,
    @Inject(OCCASION_CATEGORY_REPOSITORY)
    private readonly occasionCategoryRepository: OccasionCategoryRepository,
  ) {}

  async read(branchId: BranchId): Promise<BranchCategoriesResult> {
    const [cuisineIds, occasionIds] = await Promise.all([
      this.branchCategoryRepository.findCategoryIds(branchId, 'cuisine'),
      this.branchCategoryRepository.findCategoryIds(branchId, 'occasion'),
    ]);
    const [cuisines, occasions] = await Promise.all([
      this.cuisineCategoryRepository.findByIds(cuisineIds),
      this.occasionCategoryRepository.findByIds(occasionIds),
    ]);
    return {
      branchId: branchId.value,
      cuisineCategories: [...cuisines]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((category) => toCuisineCategoryResult(category)),
      occasionCategories: [...occasions]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((category) => toOccasionCategoryResult(category)),
    };
  }
}
