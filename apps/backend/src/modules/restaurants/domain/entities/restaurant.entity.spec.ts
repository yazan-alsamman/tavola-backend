import { Restaurant } from './restaurant.entity';
import { RestaurantStatus } from '../enums/restaurant.enums';
import { InvalidRestaurantSlugException } from '@shared/domain/value-objects/restaurant-slug.vo';

describe('Restaurant entity', () => {
  const baseProps = {
    id: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    name: 'The Old Mill',
    slug: 'the-old-mill',
    logoId: null,
    coverImageId: null,
    description: null,
    cuisineType: null,
    averageRating: null,
    priceLevel: null,
    status: RestaurantStatus.Active,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };

  function createRestaurant(): Restaurant {
    return Restaurant.reconstitute({ ...baseProps });
  }

  describe('create', () => {
    it('creates a restaurant with a valid slug', () => {
      const restaurant = Restaurant.create({ ...baseProps });
      expect(restaurant.name).toBe('The Old Mill');
      expect(restaurant.slug.value).toBe('the-old-mill');
    });

    it('rejects an invalid slug', () => {
      expect(() => Restaurant.create({ ...baseProps, slug: 'Not A Slug!' })).toThrow(
        InvalidRestaurantSlugException,
      );
    });
  });

  describe('updateProfile', () => {
    it('replaces name/description/cuisineType/priceLevel', () => {
      const restaurant = createRestaurant();
      const at = new Date('2026-02-01T00:00:00.000Z');

      const updated = restaurant.updateProfile(
        { name: 'New Name', description: 'A cozy place', cuisineType: 'Italian', priceLevel: 3 },
        at,
      );

      expect(updated.name).toBe('New Name');
      expect(updated.description).toBe('A cozy place');
      expect(updated.cuisineType).toBe('Italian');
      expect(updated.priceLevel).toBe(3);
      expect(updated.updatedAt).toEqual(at);
    });

    it('does not mutate the original instance (immutability)', () => {
      const restaurant = createRestaurant();

      restaurant.updateProfile(
        { name: 'Changed', description: null, cuisineType: null, priceLevel: null },
        new Date('2026-02-01T00:00:00.000Z'),
      );

      expect(restaurant.name).toBe('The Old Mill');
    });

    it('never changes organizationId, slug, status, or averageRating', () => {
      const restaurant = createRestaurant();

      const updated = restaurant.updateProfile(
        { name: 'Changed', description: null, cuisineType: null, priceLevel: null },
        new Date('2026-02-01T00:00:00.000Z'),
      );

      expect(updated.organizationId.value).toBe(restaurant.organizationId.value);
      expect(updated.slug.value).toBe(restaurant.slug.value);
      expect(updated.status).toBe(restaurant.status);
      expect(updated.averageRating).toBe(restaurant.averageRating);
    });
  });

  describe('activate / suspend', () => {
    it('suspend() transitions an active restaurant to Suspended', () => {
      const restaurant = createRestaurant();
      const at = new Date('2026-02-01T00:00:00.000Z');

      const suspended = restaurant.suspend(at);

      expect(suspended.status).toBe(RestaurantStatus.Suspended);
      expect(suspended.updatedAt).toEqual(at);
    });

    it('suspend() is a no-op (same instance) when already Suspended', () => {
      const restaurant = Restaurant.reconstitute({
        ...baseProps,
        status: RestaurantStatus.Suspended,
      });

      const result = restaurant.suspend(new Date('2026-02-01T00:00:00.000Z'));

      expect(result).toBe(restaurant);
    });

    it('activate() transitions a suspended restaurant back to Active', () => {
      const restaurant = Restaurant.reconstitute({
        ...baseProps,
        status: RestaurantStatus.Suspended,
      });
      const at = new Date('2026-02-01T00:00:00.000Z');

      const activated = restaurant.activate(at);

      expect(activated.status).toBe(RestaurantStatus.Active);
      expect(activated.updatedAt).toEqual(at);
    });

    it('activate() is a no-op (same instance) when already Active', () => {
      const restaurant = createRestaurant();

      const result = restaurant.activate(new Date('2026-02-01T00:00:00.000Z'));

      expect(result).toBe(restaurant);
    });
  });

  describe('softDelete', () => {
    it('sets deletedAt and reports isSoftDeleted()', () => {
      const restaurant = createRestaurant();
      const at = new Date('2026-02-01T00:00:00.000Z');

      const deleted = restaurant.softDelete(at);

      expect(deleted.deletedAt).toEqual(at);
      expect(deleted.isSoftDeleted()).toBe(true);
      expect(restaurant.isSoftDeleted()).toBe(false);
    });
  });

  describe('isActive', () => {
    it('is true only when status is Active and not soft-deleted', () => {
      const restaurant = createRestaurant();
      expect(restaurant.isActive()).toBe(true);

      const suspended = restaurant.suspend(new Date());
      expect(suspended.isActive()).toBe(false);

      const deleted = restaurant.softDelete(new Date());
      expect(deleted.isActive()).toBe(false);
    });
  });
});
