import { ListOccasionCategoriesUseCase } from './list-occasion-categories.use-case';
import { OccasionCategory } from '../../domain/entities/occasion-category.entity';
import { InMemoryOccasionCategoryRepository } from '../../../../../test/restaurants/support/in-memory-occasion-category.repository';

describe('ListOccasionCategoriesUseCase', () => {
  const fixedNow = new Date('2026-01-01T00:00:00.000Z');

  function category(overrides: Partial<Parameters<typeof OccasionCategory.reconstitute>[0]>) {
    return OccasionCategory.reconstitute({
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'date-night',
      name: 'Date Night',
      isActive: true,
      sortOrder: 0,
      createdAt: fixedNow,
      updatedAt: fixedNow,
      ...overrides,
    });
  }

  it('returns only active categories sorted by sortOrder', async () => {
    const repository = new InMemoryOccasionCategoryRepository();
    repository.seed(category({ id: 'b', slug: 'family', name: 'Family', sortOrder: 2 }));
    repository.seed(category({ id: 'a', slug: 'date-night', name: 'Date Night', sortOrder: 1 }));
    repository.seed(
      category({ id: 'c', slug: 'retired', name: 'Retired', isActive: false, sortOrder: 0 }),
    );
    const useCase = new ListOccasionCategoriesUseCase(repository);

    const result = await useCase.execute();

    expect(result.map((item) => item.slug)).toEqual(['date-night', 'family']);
  });

  it('returns an empty array when no categories are seeded', async () => {
    const repository = new InMemoryOccasionCategoryRepository();
    const useCase = new ListOccasionCategoriesUseCase(repository);

    const result = await useCase.execute();

    expect(result).toEqual([]);
  });
});
