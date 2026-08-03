import { MenuItem } from './menu-item.entity';
import { MenuItemAvailabilityMode, MenuItemDietaryLabel } from '../enums/menu-item.enums';
import { InvalidMenuItemException } from '../exceptions/invalid-menu-item.exception';

describe('MenuItem entity', () => {
  const fixedNow = new Date('2026-08-03T10:00:00.000Z');
  const categoryId = '88888888-8888-4888-8888-888888888888';
  const restaurantId = '33333333-3333-4333-8333-333333333333';

  function content(overrides?: Partial<Parameters<typeof MenuItem.create>[0]['content']>) {
    return {
      name: 'Margherita Pizza',
      description: 'Tomato, mozzarella, basil.',
      price: 12.5,
      currency: 'USD',
      preparationTimeMinutes: 15,
      spicyLevel: 0,
      calories: 800,
      allergens: ['gluten', 'dairy'],
      dietaryLabels: [MenuItemDietaryLabel.Vegetarian],
      ...overrides,
    };
  }

  function makeItem(overrides?: Partial<Parameters<typeof MenuItem.create>[0]['content']>) {
    return MenuItem.create({
      id: '99999999-9999-4999-8999-999999999999',
      categoryId,
      restaurantId,
      content: content(overrides),
      displayOrder: 0,
      now: fixedNow,
    });
  }

  it('creates an Item with Always availability, not featured, no image', () => {
    const item = makeItem();
    expect(item.availabilityMode).toBe(MenuItemAvailabilityMode.Always);
    expect(item.isFeatured).toBe(false);
    expect(item.imageFileId).toBeNull();
  });

  it('rejects a negative price', () => {
    expect(() => makeItem({ price: -1 })).toThrow(InvalidMenuItemException);
  });

  it('rejects an empty name', () => {
    expect(() => makeItem({ name: '' })).toThrow(InvalidMenuItemException);
  });

  it('rejects a spicyLevel outside 0-3', () => {
    expect(() => makeItem({ spicyLevel: 4 })).toThrow(InvalidMenuItemException);
    expect(() => makeItem({ spicyLevel: -1 })).toThrow(InvalidMenuItemException);
  });

  it('rejects a negative calories value', () => {
    expect(() => makeItem({ calories: -100 })).toThrow(InvalidMenuItemException);
  });

  it('rejects a negative preparationTimeMinutes', () => {
    expect(() => makeItem({ preparationTimeMinutes: -5 })).toThrow(InvalidMenuItemException);
  });

  describe('feature/unfeature (ADR-032)', () => {
    it('toggles isFeatured', () => {
      const item = makeItem();
      const featured = item.feature(fixedNow);
      expect(featured.isFeatured).toBe(true);
      const unfeatured = featured.unfeature(fixedNow);
      expect(unfeatured.isFeatured).toBe(false);
    });
  });

  describe('changeAvailabilityMode', () => {
    it('transitions between Always/Unavailable/Scheduled', () => {
      const item = makeItem();
      const scheduled = item.changeAvailabilityMode(MenuItemAvailabilityMode.Scheduled, fixedNow);
      expect(scheduled.availabilityMode).toBe(MenuItemAvailabilityMode.Scheduled);
    });
  });

  describe('image', () => {
    it('sets and removes imageFileId', () => {
      const item = makeItem();
      const fileId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const withImage = item.setImage(fileId, fixedNow);
      expect(withImage.imageFileId?.value).toBe(fileId);
      const withoutImage = withImage.removeImage(fixedNow);
      expect(withoutImage.imageFileId).toBeNull();
    });
  });

  describe('softDelete', () => {
    it('marks the item deleted', () => {
      const item = makeItem();
      const deleted = item.softDelete(fixedNow);
      expect(deleted.isDeleted()).toBe(true);
    });
  });
});
