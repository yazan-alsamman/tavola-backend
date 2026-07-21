import { OccasionCategory } from './occasion-category.entity';

describe('OccasionCategory entity', () => {
  const baseProps = {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'date-night',
    name: 'Date Night',
    isActive: true,
    sortOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  describe('reconstitute', () => {
    it('rebuilds a category from persisted props', () => {
      const category = OccasionCategory.reconstitute({ ...baseProps });

      expect(category.occasionCategoryId).toBe(baseProps.id);
      expect(category.slug).toBe('date-night');
      expect(category.name).toBe('Date Night');
      expect(category.isActive).toBe(true);
      expect(category.sortOrder).toBe(0);
    });
  });

  describe('toProps', () => {
    it('returns a snapshot of every field', () => {
      const category = OccasionCategory.reconstitute({ ...baseProps });
      expect(category.toProps()).toEqual(baseProps);
    });
  });
});
