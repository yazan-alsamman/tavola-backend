import { RestaurantCuisineCategory } from './restaurant-cuisine-category.entity';

describe('RestaurantCuisineCategory entity', () => {
  const baseProps = {
    id: '33333333-3333-4333-8333-333333333333',
    restaurantId: '44444444-4444-4444-8444-444444444444',
    cuisineCategoryId: '11111111-1111-4111-8111-111111111111',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  describe('create', () => {
    it('creates a valid assignment', () => {
      const assignment = RestaurantCuisineCategory.create({ ...baseProps });

      expect(assignment.restaurantId).toBe(baseProps.restaurantId);
      expect(assignment.cuisineCategoryId).toBe(baseProps.cuisineCategoryId);
    });

    it('rejects a blank restaurantId', () => {
      expect(() => RestaurantCuisineCategory.create({ ...baseProps, restaurantId: '  ' })).toThrow(
        'RestaurantCuisineCategory must have a restaurantId.',
      );
    });

    it('rejects a blank cuisineCategoryId', () => {
      expect(() =>
        RestaurantCuisineCategory.create({ ...baseProps, cuisineCategoryId: '  ' }),
      ).toThrow('RestaurantCuisineCategory must have a cuisineCategoryId.');
    });
  });

  describe('reconstitute', () => {
    it('bypasses validation for trusted persistence round-trips', () => {
      const assignment = RestaurantCuisineCategory.reconstitute({ ...baseProps });
      expect(assignment.cuisineCategoryId).toBe(baseProps.cuisineCategoryId);
    });
  });

  describe('toProps', () => {
    it('returns a snapshot of every field', () => {
      const assignment = RestaurantCuisineCategory.create({ ...baseProps });
      expect(assignment.toProps()).toEqual(baseProps);
    });
  });
});
