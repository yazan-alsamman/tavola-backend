import { FavoriteRestaurant } from './favorite-restaurant.entity';

describe('FavoriteRestaurant', () => {
  const baseProps = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    restaurantId: '33333333-3333-4333-8333-333333333333',
    createdAt: new Date('2026-07-14T12:00:00.000Z'),
  };

  it('creates a valid favorite', () => {
    const favorite = FavoriteRestaurant.create(baseProps);
    expect(favorite.id).toBe(baseProps.id);
    expect(favorite.userId).toBe(baseProps.userId);
    expect(favorite.restaurantId).toBe(baseProps.restaurantId);
    expect(favorite.createdAt).toEqual(baseProps.createdAt);
  });

  it('rejects an empty userId', () => {
    expect(() => FavoriteRestaurant.create({ ...baseProps, userId: '  ' })).toThrow();
  });

  it('rejects an empty restaurantId', () => {
    expect(() => FavoriteRestaurant.create({ ...baseProps, restaurantId: '' })).toThrow();
  });

  it('reconstitute bypasses validation for trusted persistence round-trips', () => {
    const favorite = FavoriteRestaurant.reconstitute(baseProps);
    expect(favorite.restaurantId).toBe(baseProps.restaurantId);
  });

  it('createdAt getter returns a defensive copy', () => {
    const favorite = FavoriteRestaurant.create(baseProps);
    const returned = favorite.createdAt;
    returned.setFullYear(1970);
    expect(favorite.createdAt).toEqual(baseProps.createdAt);
  });

  it('toProps returns a plain snapshot matching the constructed props', () => {
    const favorite = FavoriteRestaurant.create(baseProps);
    expect(favorite.toProps()).toEqual(baseProps);
  });
});
