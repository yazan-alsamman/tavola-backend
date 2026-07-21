import { CuisineCategory } from './cuisine-category.entity';

describe('CuisineCategory entity', () => {
  const baseProps = {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'italian',
    name: 'Italian',
    isActive: true,
    sortOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  describe('reconstitute', () => {
    it('rebuilds a category from persisted props', () => {
      const category = CuisineCategory.reconstitute({ ...baseProps });

      expect(category.cuisineCategoryId).toBe(baseProps.id);
      expect(category.slug).toBe('italian');
      expect(category.name).toBe('Italian');
      expect(category.isActive).toBe(true);
      expect(category.sortOrder).toBe(0);
    });
  });

  describe('toProps', () => {
    it('returns a snapshot of every field', () => {
      const category = CuisineCategory.reconstitute({ ...baseProps });
      expect(category.toProps()).toEqual(baseProps);
    });
  });
});
