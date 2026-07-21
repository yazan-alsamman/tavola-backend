import { RestaurantOccasionCategory } from './restaurant-occasion-category.entity';

describe('RestaurantOccasionCategory entity', () => {
  const baseProps = {
    id: '55555555-5555-4555-8555-555555555555',
    restaurantId: '44444444-4444-4444-8444-444444444444',
    occasionCategoryId: '22222222-2222-4222-8222-222222222222',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  describe('create', () => {
    it('creates a valid assignment', () => {
      const assignment = RestaurantOccasionCategory.create({ ...baseProps });

      expect(assignment.restaurantId).toBe(baseProps.restaurantId);
      expect(assignment.occasionCategoryId).toBe(baseProps.occasionCategoryId);
    });

    it('rejects a blank restaurantId', () => {
      expect(() => RestaurantOccasionCategory.create({ ...baseProps, restaurantId: '  ' })).toThrow(
        'RestaurantOccasionCategory must have a restaurantId.',
      );
    });

    it('rejects a blank occasionCategoryId', () => {
      expect(() =>
        RestaurantOccasionCategory.create({ ...baseProps, occasionCategoryId: '  ' }),
      ).toThrow('RestaurantOccasionCategory must have a occasionCategoryId.');
    });
  });

  describe('reconstitute', () => {
    it('bypasses validation for trusted persistence round-trips', () => {
      const assignment = RestaurantOccasionCategory.reconstitute({ ...baseProps });
      expect(assignment.occasionCategoryId).toBe(baseProps.occasionCategoryId);
    });
  });

  describe('toProps', () => {
    it('returns a snapshot of every field', () => {
      const assignment = RestaurantOccasionCategory.create({ ...baseProps });
      expect(assignment.toProps()).toEqual(baseProps);
    });
  });
});
