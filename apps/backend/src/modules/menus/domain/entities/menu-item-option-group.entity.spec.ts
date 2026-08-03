import { MenuItemOptionGroup } from './menu-item-option-group.entity';
import { InvalidMenuItemOptionGroupException } from '../exceptions/invalid-menu-item-option-group.exception';

describe('MenuItemOptionGroup entity', () => {
  const fixedNow = new Date('2026-08-03T10:00:00.000Z');
  const menuItemId = '55555555-5555-4555-8555-555555555555';
  const restaurantId = '33333333-3333-4333-8333-333333333333';

  function makeGroup(overrides?: {
    required?: boolean;
    minSelections?: number;
    maxSelections?: number;
  }) {
    return MenuItemOptionGroup.create({
      id: '66666666-6666-4666-8666-666666666666',
      menuItemId,
      restaurantId,
      content: {
        name: 'Choose your size',
        required: overrides?.required ?? false,
        minSelections: overrides?.minSelections ?? 0,
        maxSelections: overrides?.maxSelections ?? 1,
      },
      displayOrder: 0,
      now: fixedNow,
    });
  }

  it('creates a valid option group', () => {
    const group = makeGroup();
    expect(group.name).toBe('Choose your size');
    expect(group.required).toBe(false);
  });

  it('rejects minSelections greater than maxSelections', () => {
    expect(() => makeGroup({ minSelections: 3, maxSelections: 1 })).toThrow(
      InvalidMenuItemOptionGroupException,
    );
  });

  it('rejects a required group with minSelections of 0', () => {
    expect(() => makeGroup({ required: true, minSelections: 0, maxSelections: 1 })).toThrow(
      InvalidMenuItemOptionGroupException,
    );
  });

  it('accepts a required group with minSelections >= 1', () => {
    const group = makeGroup({ required: true, minSelections: 1, maxSelections: 1 });
    expect(group.required).toBe(true);
  });

  it('rejects a negative minSelections', () => {
    expect(() => makeGroup({ minSelections: -1 })).toThrow(InvalidMenuItemOptionGroupException);
  });

  it('rejects a maxSelections below 1', () => {
    expect(() => makeGroup({ maxSelections: 0 })).toThrow(InvalidMenuItemOptionGroupException);
  });
});
