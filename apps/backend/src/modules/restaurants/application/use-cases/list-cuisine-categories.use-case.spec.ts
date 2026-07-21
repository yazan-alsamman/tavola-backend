import { ListCuisineCategoriesUseCase } from './list-cuisine-categories.use-case';
import { CuisineCategory } from '../../domain/entities/cuisine-category.entity';
import { InMemoryCuisineCategoryRepository } from '../../../../../test/restaurants/support/in-memory-cuisine-category.repository';

describe('ListCuisineCategoriesUseCase', () => {
  const fixedNow = new Date('2026-01-01T00:00:00.000Z');

  function category(overrides: Partial<Parameters<typeof CuisineCategory.reconstitute>[0]>) {
    return CuisineCategory.reconstitute({
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'italian',
      name: 'Italian',
      isActive: true,
      sortOrder: 0,
      createdAt: fixedNow,
      updatedAt: fixedNow,
      ...overrides,
    });
  }

  it('returns only active categories sorted by sortOrder', async () => {
    const repository = new InMemoryCuisineCategoryRepository();
    repository.seed(category({ id: 'b', slug: 'japanese', name: 'Japanese', sortOrder: 2 }));
    repository.seed(category({ id: 'a', slug: 'italian', name: 'Italian', sortOrder: 1 }));
    repository.seed(
      category({ id: 'c', slug: 'retired', name: 'Retired', isActive: false, sortOrder: 0 }),
    );
    const useCase = new ListCuisineCategoriesUseCase(repository);

    const result = await useCase.execute();

    expect(result.map((item) => item.slug)).toEqual(['italian', 'japanese']);
  });

  it('returns an empty array when no categories are seeded', async () => {
    const repository = new InMemoryCuisineCategoryRepository();
    const useCase = new ListCuisineCategoriesUseCase(repository);

    const result = await useCase.execute();

    expect(result).toEqual([]);
  });
});
