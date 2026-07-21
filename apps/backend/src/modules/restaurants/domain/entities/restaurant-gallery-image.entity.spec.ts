import { RestaurantGalleryImage } from './restaurant-gallery-image.entity';
import { InvalidRestaurantGalleryImageException } from '../exceptions/invalid-restaurant-gallery-image.exception';

describe('RestaurantGalleryImage entity', () => {
  const baseProps = {
    id: '11111111-1111-4111-8111-111111111111',
    restaurantId: '22222222-2222-4222-8222-222222222222',
    fileId: '33333333-3333-4333-8333-333333333333',
    caption: null as string | null,
    sortOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  it('creates a valid gallery image with no caption', () => {
    const image = RestaurantGalleryImage.create({ ...baseProps });

    expect(image.restaurantId.value).toBe(baseProps.restaurantId);
    expect(image.fileId.value).toBe(baseProps.fileId);
    expect(image.caption).toBeNull();
    expect(image.sortOrder).toBe(0);
  });

  it('creates a valid gallery image with a caption', () => {
    const image = RestaurantGalleryImage.create({ ...baseProps, caption: 'Our dining room' });
    expect(image.caption).toBe('Our dining room');
  });

  it.each([
    ['empty restaurantId', { restaurantId: '' }],
    ['empty fileId', { fileId: '' }],
    ['negative sortOrder', { sortOrder: -1 }],
    ['non-integer sortOrder', { sortOrder: 1.5 }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => RestaurantGalleryImage.create({ ...baseProps, ...overrides })).toThrow(
      InvalidRestaurantGalleryImageException,
    );
  });

  describe('reconstitute', () => {
    it('bypasses validation for trusted persistence round-trips', () => {
      const image = RestaurantGalleryImage.reconstitute({ ...baseProps, sortOrder: 5 });
      expect(image.sortOrder).toBe(5);
    });
  });

  describe('toProps', () => {
    it('returns a snapshot of every field', () => {
      const image = RestaurantGalleryImage.create({ ...baseProps });
      expect(image.toProps()).toEqual(baseProps);
    });
  });
});
