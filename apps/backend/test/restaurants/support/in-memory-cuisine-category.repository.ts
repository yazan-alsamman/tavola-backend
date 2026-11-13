import { CuisineCategory } from '@modules/restaurants/domain/entities/cuisine-category.entity';
import { CuisineCategoryRepository } from '@modules/restaurants/domain/repositories/cuisine-category.repository';

export class InMemoryCuisineCategoryRepository implements CuisineCategoryRepository {
  private readonly rows = new Map<string, CuisineCategory>();

  seed(category: CuisineCategory): void {
    this.rows.set(category.cuisineCategoryId, category);
  }

  async findAllActive(): Promise<CuisineCategory[]> {
    return [...this.rows.values()].filter((row) => row.isActive);
  }

  async findByIds(ids: string[]): Promise<CuisineCategory[]> {
    return ids.map((id) => this.rows.get(id)).filter((row): row is CuisineCategory => !!row);
  }
}

/**
 * An `InMemoryCuisineCategoryRepository` pre-seeded with the active
 * categories the Restaurant use-case specs write as `cuisineType`.
 */
export function createSeededCuisineCategoryRepository(): InMemoryCuisineCategoryRepository {
  const repository = new InMemoryCuisineCategoryRepository();
  const at = new Date('2026-01-01T00:00:00.000Z');
  [
    { id: 'c0000000-0000-4000-8000-000000000001', slug: 'italian', name: 'Italian' },
    { id: 'c0000000-0000-4000-8000-000000000002', slug: 'french', name: 'French' },
    { id: 'c0000000-0000-4000-8000-000000000003', slug: 'oriental', name: 'Oriental' },
  ].forEach((row, sortOrder) =>
    repository.seed(
      CuisineCategory.reconstitute({
        ...row,
        isActive: true,
        sortOrder,
        createdAt: at,
        updatedAt: at,
      }),
    ),
  );
  return repository;
}
