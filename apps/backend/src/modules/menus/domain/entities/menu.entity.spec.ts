import { Menu } from './menu.entity';
import { InvalidMenuException } from '../exceptions/invalid-menu.exception';

describe('Menu entity', () => {
  const fixedNow = new Date('2026-08-03T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';

  function makeMenu(overrides?: { name?: string; isDefault?: boolean }) {
    return Menu.create({
      id: '22222222-2222-4222-8222-222222222222',
      restaurantId,
      name: overrides?.name,
      isDefault: overrides?.isDefault ?? false,
      now: fixedNow,
    });
  }

  describe('create', () => {
    it('creates an active Menu defaulting to "Main Menu"', () => {
      const menu = makeMenu();
      expect(menu.name).toBe('Main Menu');
      expect(menu.active).toBe(true);
      expect(menu.isDefault).toBe(false);
      expect(menu.displayOrder).toBe(0);
      expect(menu.deletedAt).toBeNull();
    });

    it('accepts an explicit name', () => {
      const menu = makeMenu({ name: 'Breakfast Menu' });
      expect(menu.name).toBe('Breakfast Menu');
    });

    it('rejects an empty name', () => {
      expect(() => makeMenu({ name: '' })).toThrow(InvalidMenuException);
      expect(() => makeMenu({ name: '   ' })).toThrow(InvalidMenuException);
    });

    it('rejects a name over 200 characters', () => {
      expect(() => makeMenu({ name: 'a'.repeat(201) })).toThrow(InvalidMenuException);
    });

    it('can be created as the default Menu', () => {
      const menu = makeMenu({ isDefault: true });
      expect(menu.isDefault).toBe(true);
    });
  });

  describe('update', () => {
    it('updates name and displayOrder together (EVENTS.md MenuUpdated)', () => {
      const menu = makeMenu();
      const later = new Date(fixedNow.getTime() + 1000);
      const updated = menu.update({ name: 'Dinner Menu', displayOrder: 3 }, later);
      expect(updated.name).toBe('Dinner Menu');
      expect(updated.displayOrder).toBe(3);
      expect(updated.updatedAt).toEqual(later);
    });

    it('rejects an empty name on update', () => {
      const menu = makeMenu();
      expect(() => menu.update({ name: '', displayOrder: 0 }, fixedNow)).toThrow(
        InvalidMenuException,
      );
    });
  });

  describe('activate/deactivate', () => {
    it('toggles active independently of isDefault', () => {
      const menu = makeMenu({ isDefault: true });
      const deactivated = menu.deactivate(fixedNow);
      expect(deactivated.active).toBe(false);
      expect(deactivated.isDefault).toBe(true);
      const reactivated = deactivated.activate(fixedNow);
      expect(reactivated.active).toBe(true);
    });
  });

  describe('markAsDefault', () => {
    it('sets isDefault to true', () => {
      const menu = makeMenu({ isDefault: false });
      const promoted = menu.markAsDefault(fixedNow);
      expect(promoted.isDefault).toBe(true);
    });
  });

  describe('softDelete', () => {
    it('sets deletedAt and isDeleted() becomes true', () => {
      const menu = makeMenu();
      expect(menu.isDeleted()).toBe(false);
      const deleted = menu.softDelete(fixedNow);
      expect(deleted.isDeleted()).toBe(true);
      expect(deleted.deletedAt).toEqual(fixedNow);
    });
  });
});
