import { FloorPlanArea, FloorPlanAreaProps } from './floor-plan-area.entity';
import { InvalidFloorPlanAreaException } from '../exceptions/invalid-floor-plan-area.exception';
import { InvalidHexColorException } from '../exceptions/invalid-hex-color.exception';

describe('FloorPlanArea (ADR-040)', () => {
  const createdAt = new Date('2026-09-24T10:00:00.000Z');
  const later = new Date('2026-09-24T11:00:00.000Z');
  const areaId = '11111111-1111-4111-8111-111111111111';
  const floorPlanId = '22222222-2222-4222-8222-222222222222';

  function baseProps(overrides: Partial<FloorPlanAreaProps> = {}): FloorPlanAreaProps {
    return {
      id: areaId,
      floorPlanId,
      name: 'Main Hall',
      color: '#14B8A6',
      sortOrder: 0,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
      ...overrides,
    };
  }

  describe('create()', () => {
    it('normalizes the color to the single stored form', () => {
      expect(FloorPlanArea.create(baseProps({ color: '#14b8a6' })).color).toBe('#14B8A6');
    });

    it('trims the name, so one name cannot be created twice under two spellings', () => {
      expect(FloorPlanArea.create(baseProps({ name: '  Main Hall  ' })).name).toBe('Main Hall');
    });

    it('accepts a non-Latin name unchanged', () => {
      expect(FloorPlanArea.create(baseProps({ name: 'للضيوف' })).name).toBe('للضيوف');
    });

    it.each([
      ['empty', ''],
      ['whitespace only', '   '],
    ])('rejects a %s name', (_label, name) => {
      expect(() => FloorPlanArea.create(baseProps({ name }))).toThrow(
        InvalidFloorPlanAreaException,
      );
    });

    it('rejects a malformed color', () => {
      expect(() => FloorPlanArea.create(baseProps({ color: 'teal' }))).toThrow(
        InvalidHexColorException,
      );
    });

    it.each([
      ['negative', -1],
      ['fractional', 1.5],
    ])('rejects a %s sortOrder', (_label, sortOrder) => {
      expect(() => FloorPlanArea.create(baseProps({ sortOrder }))).toThrow(
        InvalidFloorPlanAreaException,
      );
    });

    it('has no activation concept - FloorPlan.isActive is a different axis', () => {
      const area = FloorPlanArea.create(baseProps());
      expect(area.toProps()).not.toHaveProperty('isActive');
    });
  });

  describe('updateProfile()', () => {
    it('replaces name, color and sortOrder, and stamps updatedAt', () => {
      const area = FloorPlanArea.create(baseProps());

      const updated = area.updateProfile({ name: 'Guests', color: '#f97316', sortOrder: 2 }, later);

      expect(updated.name).toBe('Guests');
      expect(updated.color).toBe('#F97316');
      expect(updated.sortOrder).toBe(2);
      expect(updated.updatedAt).toEqual(later);
    });

    it('never reassigns the floor plan - the tables inside are positioned relative to it', () => {
      const area = FloorPlanArea.create(baseProps());

      const updated = area.updateProfile({ name: 'Guests', color: '#F97316', sortOrder: 2 }, later);

      expect(updated.floorPlanId.value).toBe(floorPlanId);
      expect(updated.floorPlanAreaId.value).toBe(areaId);
      expect(updated.createdAt).toEqual(createdAt);
    });

    it('leaves the original instance untouched', () => {
      const area = FloorPlanArea.create(baseProps());

      area.updateProfile({ name: 'Guests', color: '#F97316', sortOrder: 2 }, later);

      expect(area.name).toBe('Main Hall');
      expect(area.color).toBe('#14B8A6');
    });

    it('rejects an invalid color without mutating anything', () => {
      const area = FloorPlanArea.create(baseProps());

      expect(() =>
        area.updateProfile({ name: 'Guests', color: '#FFF', sortOrder: 0 }, later),
      ).toThrow(InvalidHexColorException);
      expect(area.color).toBe('#14B8A6');
    });
  });

  describe('softDelete()', () => {
    it('stamps deletedAt and updatedAt without removing anything else', () => {
      const area = FloorPlanArea.create(baseProps());

      const deleted = area.softDelete(later);

      expect(deleted.isSoftDeleted()).toBe(true);
      expect(deleted.deletedAt).toEqual(later);
      expect(deleted.updatedAt).toEqual(later);
      expect(deleted.name).toBe('Main Hall');
    });

    it('reports not-deleted for a live area', () => {
      expect(FloorPlanArea.create(baseProps()).isSoftDeleted()).toBe(false);
    });
  });

  describe('reconstitute()', () => {
    it('does not re-validate, so an already-persisted row always loads', () => {
      const area = FloorPlanArea.reconstitute(baseProps({ color: '#14b8a6' }));
      expect(area.color).toBe('#14b8a6');
    });
  });
});
