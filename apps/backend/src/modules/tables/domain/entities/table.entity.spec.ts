import { Table } from './table.entity';
import { TableShape, TableStatus } from '../enums/table.enums';
import { InvalidTableStatusTransitionException } from '../exceptions/invalid-table-status-transition.exception';

describe('Table entity', () => {
  const now = new Date('2026-07-23T12:00:00.000Z');
  const later = new Date('2026-07-23T12:05:00.000Z');
  const reservationId = '99999999-9999-4999-8999-999999999999';

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
});
