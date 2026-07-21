import { Injectable, Inject } from '@nestjs/common';
import {
  OccasionCategoryRepository,
  OCCASION_CATEGORY_REPOSITORY,
} from '../../domain/repositories/occasion-category.repository';
import { toOccasionCategoryResult } from '../mappers/occasion-category-result.mapper';
import { OccasionCategoryResult } from '../dto/occasion-category.result';

/**
 * Public reference-data listing (ADR-018) - no actor/tenant scoping, since
 * `OccasionCategory` is platform-managed, not tenant-owned. Sorted by
 * `sortOrder` for stable client-side rendering.
 */
@Injectable()
export class ListOccasionCategoriesUseCase {
  constructor(
    @Inject(OCCASION_CATEGORY_REPOSITORY)
    private readonly occasionCategoryRepository: OccasionCategoryRepository,
  ) {}

  async execute(): Promise<OccasionCategoryResult[]> {
    const categories = await this.occasionCategoryRepository.findAllActive();
    return [...categories]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((category) => toOccasionCategoryResult(category));
  }
}
