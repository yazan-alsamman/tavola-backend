import { Injectable, Inject } from '@nestjs/common';
import {
  CuisineCategoryRepository,
  CUISINE_CATEGORY_REPOSITORY,
} from '../../domain/repositories/cuisine-category.repository';
import { toCuisineCategoryResult } from '../mappers/cuisine-category-result.mapper';
import { CuisineCategoryResult } from '../dto/cuisine-category.result';

/**
 * Public reference-data listing (ADR-018) - no actor/tenant scoping, since
 * `CuisineCategory` is platform-managed, not tenant-owned. Sorted by
 * `sortOrder` for stable client-side rendering.
 */
@Injectable()
export class ListCuisineCategoriesUseCase {
  constructor(
    @Inject(CUISINE_CATEGORY_REPOSITORY)
    private readonly cuisineCategoryRepository: CuisineCategoryRepository,
  ) {}

  async execute(): Promise<CuisineCategoryResult[]> {
    const categories = await this.cuisineCategoryRepository.findAllActive();
    return [...categories]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((category) => toCuisineCategoryResult(category));
  }
}
