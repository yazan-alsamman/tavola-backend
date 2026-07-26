import { Table } from './table.entity';
import { TableShape, TableStatus } from '../enums/table.enums';
import { InvalidTableStatusTransitionException } from '../exceptions/invalid-table-status-transition.exception';
import { InvalidTableException } from '../exceptions/invalid-table.exception';
import { TableMergeConflictException } from '../exceptions/table-merge-conflict.exception';
import { TableNotMergedException } from '../exceptions/table-not-merged.exception';

describe('Table entity', () => {
  const now = new Date('2026-07-23T12:00:00.000Z');
  const later = new Date('2026-07-23T12:05:00.000Z');
  const reservationId = '99999999-9999-4999-8999-999999999999';
  const mergeGroupId = '88888888-8888-4888-8888-888888888888';

  function baseTable(status: TableStatus = TableStatus.Available): Table {
    return Table.create({
      id: '11111111-1111-4111-8111-111111111111',
      branchId: '22222222-2222-4222-8222-222222222222',
      floorPlanId: '33333333-3333-4333-8333-333333333333',
      tableNumber: 'T1',
      capacity: 4,
      floor: null,
      positionX: null,
      positionY: null,
      width: null,
      height: null,
      rotation: null,
      shape: TableShape.Rectangle,
      layer: null,
      indoor: true,
      vip: false,
      smoking: false,
      status,
      mergeGroupId: null,
      isMergePrimary: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  /**
   * `Table.create` always forces `mergeGroupId: null`/`isMergePrimary: false`
   * (Phase 6, ADR-026) - tests that need an already-merged starting state use
   * `Table.reconstitute` directly, exactly like a Prisma-mapper-loaded row.
   */
  function mergedTable(
    status: TableStatus,
    overrides: Partial<{ isMergePrimary: boolean; groupId: string }> = {},
  ): Table {
    return Table.reconstitute({
      id: '11111111-1111-4111-8111-111111111111',
      branchId: '22222222-2222-4222-8222-222222222222',
      floorPlanId: '33333333-3333-4333-8333-333333333333',
      tableNumber: 'T1',
      capacity: 4,
      floor: null,
      positionX: null,
      positionY: null,
      width: null,
      height: null,
      rotation: null,
      shape: TableShape.Rectangle,
      layer: null,
      indoor: true,
      vip: false,
      smoking: false,
      status,
      mergeGroupId: overrides.groupId ?? mergeGroupId,
      isMergePrimary: overrides.isMergePrimary ?? false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  describe('reserve()', () => {
    it('transitions an Available table to Reserved', () => {
      const table = baseTable(TableStatus.Available);
      const reserved = table.reserve(reservationId, later);

      expect(reserved.status).toBe(TableStatus.Reserved);
      expect(reserved.updatedAt).toEqual(later);
    });

    it.each([
      TableStatus.Occupied,
      TableStatus.Cleaning,
      TableStatus.Disabled,
      TableStatus.Reserved,
    ])('rejects reserving a table currently %s', (status) => {
      const table = baseTable(status);
      expect(() => table.reserve(reservationId, later)).toThrow(
        InvalidTableStatusTransitionException,
      );
    });
  });

  describe('release()', () => {
    it('transitions a Reserved table back to Available', () => {
      const table = baseTable(TableStatus.Reserved);
      const released = table.release(later);

      expect(released.status).toBe(TableStatus.Available);
      expect(released.updatedAt).toEqual(later);
    });

    it.each([
      TableStatus.Available,
      TableStatus.Occupied,
      TableStatus.Cleaning,
      TableStatus.Disabled,
    ])('rejects releasing a table currently %s', (status) => {
      const table = baseTable(status);
      expect(() => table.release(later)).toThrow(InvalidTableStatusTransitionException);
    });
  });

  describe('transitionStatus() cannot manually reach Reserved (Phase 7.2 architecture freeze)', () => {
    it('rejects Available -> Reserved', () => {
      const table = baseTable(TableStatus.Available);
      expect(() => table.transitionStatus(TableStatus.Reserved, later)).toThrow(
        InvalidTableStatusTransitionException,
      );
    });

    it.each([
      TableStatus.Available,
      TableStatus.Occupied,
      TableStatus.Cleaning,
      TableStatus.Disabled,
    ])('rejects Reserved -> %s (Reserved as current status)', (target) => {
      const table = baseTable(TableStatus.Reserved);
      expect(() => table.transitionStatus(target, later)).toThrow(
        InvalidTableStatusTransitionException,
      );
    });

    it('still allows the ordinary Available <-> Occupied transition unaffected by the Reserved guard', () => {
      const table = baseTable(TableStatus.Available);
      const occupied = table.transitionStatus(TableStatus.Occupied, later);
      expect(occupied.status).toBe(TableStatus.Occupied);
    });
  });

  // ---------------------------------------------------------------------
  // Phase 6 (Merge/Split Tables, ADR-026): asMergePrimary/asMergeSecondary/
  // clearMergeMembership, and the merge guards on moveToFloorPlan/
  // transitionStatus.
  // ---------------------------------------------------------------------

  describe('asMergePrimary()', () => {
    it('marks an Available table as the Primary of mergeGroupId, keeping status Available', () => {
      const table = baseTable(TableStatus.Available);
      const primary = table.asMergePrimary(mergeGroupId, later);

      expect(primary.mergeGroupId).toBe(mergeGroupId);
      expect(primary.isMergePrimary).toBe(true);
      expect(primary.status).toBe(TableStatus.Available);
      expect(primary.isInMergeGroup).toBe(true);
      expect(primary.updatedAt).toEqual(later);
      // Permanent capacity/table id are never touched.
      expect(primary.capacity).toBe(4);
    });

    it('rejects a table already part of a merge group', () => {
      const table = mergedTable(TableStatus.Available, { isMergePrimary: true });
      expect(() => table.asMergePrimary('99999999-9999-4999-8999-999999999998', later)).toThrow(
        TableMergeConflictException,
      );
    });

    it.each([
      TableStatus.Occupied,
      TableStatus.Cleaning,
      TableStatus.Disabled,
      TableStatus.Reserved,
    ])('rejects a table currently %s (only Available tables can be merged)', (status) => {
      const table = baseTable(status);
      expect(() => table.asMergePrimary(mergeGroupId, later)).toThrow(TableMergeConflictException);
    });
  });

  describe('asMergeSecondary()', () => {
    it('marks an Available table as a Secondary of mergeGroupId, transitioning status to Merged', () => {
      const table = baseTable(TableStatus.Available);
      const secondary = table.asMergeSecondary(mergeGroupId, later);

      expect(secondary.mergeGroupId).toBe(mergeGroupId);
      expect(secondary.isMergePrimary).toBe(false);
      expect(secondary.status).toBe(TableStatus.Merged);
      expect(secondary.isInMergeGroup).toBe(true);
      expect(secondary.updatedAt).toEqual(later);
      expect(secondary.capacity).toBe(4);
    });

    it('rejects a table already part of a merge group', () => {
      const table = mergedTable(TableStatus.Merged);
      expect(() => table.asMergeSecondary('99999999-9999-4999-8999-999999999998', later)).toThrow(
        TableMergeConflictException,
      );
    });

    it.each([
      TableStatus.Occupied,
      TableStatus.Cleaning,
      TableStatus.Disabled,
      TableStatus.Reserved,
    ])('rejects a table currently %s (only Available tables can be merged)', (status) => {
      const table = baseTable(status);
      expect(() => table.asMergeSecondary(mergeGroupId, later)).toThrow(
        TableMergeConflictException,
      );
    });
  });

  describe('clearMergeMembership()', () => {
    it('restores a former Secondary (status Merged) to Available and clears membership', () => {
      const secondary = mergedTable(TableStatus.Merged, { isMergePrimary: false });
      const cleared = secondary.clearMergeMembership(later);

      expect(cleared.mergeGroupId).toBeNull();
      expect(cleared.isMergePrimary).toBe(false);
      expect(cleared.status).toBe(TableStatus.Available);
      expect(cleared.isInMergeGroup).toBe(false);
      expect(cleared.updatedAt).toEqual(later);
    });

    it('keeps a former Primary’s current status unchanged (Available stays Available)', () => {
      const primary = mergedTable(TableStatus.Available, { isMergePrimary: true });
      const cleared = primary.clearMergeMembership(later);

      expect(cleared.mergeGroupId).toBeNull();
      expect(cleared.isMergePrimary).toBe(false);
      expect(cleared.status).toBe(TableStatus.Available);
    });

    it('keeps a former Primary’s current status unchanged (Reserved stays Reserved - an Approved reservation still targets it)', () => {
      const primary = mergedTable(TableStatus.Reserved, { isMergePrimary: true });
      const cleared = primary.clearMergeMembership(later);

      expect(cleared.mergeGroupId).toBeNull();
      expect(cleared.isMergePrimary).toBe(false);
      expect(cleared.status).toBe(TableStatus.Reserved);
    });

    it('rejects a table that is not currently part of a merge group', () => {
      const table = baseTable(TableStatus.Available);
      expect(() => table.clearMergeMembership(later)).toThrow(TableNotMergedException);
    });
  });

  describe('moveToFloorPlan() rejects a table that is part of an active merge group (ADR-026 decision #11/#13)', () => {
    it('throws InvalidTableException for a Primary', () => {
      const primary = mergedTable(TableStatus.Available, { isMergePrimary: true });
      expect(() => primary.moveToFloorPlan('44444444-4444-4444-8444-444444444444', later)).toThrow(
        InvalidTableException,
      );
    });

    it('throws InvalidTableException for a Secondary', () => {
      const secondary = mergedTable(TableStatus.Merged, { isMergePrimary: false });
      expect(() =>
        secondary.moveToFloorPlan('44444444-4444-4444-8444-444444444444', later),
      ).toThrow(InvalidTableException);
    });

    it('still allows moving an ordinary (non-merged) table', () => {
      const table = baseTable(TableStatus.Available);
      const moved = table.moveToFloorPlan('44444444-4444-4444-8444-444444444444', later);
      expect(moved.floorPlanId.value).toBe('44444444-4444-4444-8444-444444444444');
    });
  });

  describe('transitionStatus() rejects a table that is part of an active merge group (ADR-026 decision #11/#13)', () => {
    it('throws InvalidTableStatusTransitionException for a Primary (status Available)', () => {
      const primary = mergedTable(TableStatus.Available, { isMergePrimary: true });
      expect(() => primary.transitionStatus(TableStatus.Occupied, later)).toThrow(
        InvalidTableStatusTransitionException,
      );
    });

    it('throws InvalidTableStatusTransitionException for a Secondary (status Merged), even targeting Available', () => {
      const secondary = mergedTable(TableStatus.Merged, { isMergePrimary: false });
      expect(() => secondary.transitionStatus(TableStatus.Available, later)).toThrow(
        InvalidTableStatusTransitionException,
      );
    });
  });
});
