import { ListReservationTimeSlotsUseCase } from './list-reservation-time-slots.use-case';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { BranchWorkingHours } from '@modules/branches/domain/entities/branch-working-hours.entity';
import { ListBranchWorkingHoursByBranchIdsUseCase } from '@modules/branches/application/use-cases/list-branch-working-hours-by-branch-ids.use-case';
import { WorkingHours } from '@modules/restaurants/domain/entities/working-hours.entity';
import { ListWorkingHoursByRestaurantIdsUseCase } from '@modules/restaurants/application/use-cases/list-working-hours-by-restaurant-ids.use-case';
import { RestaurantSettings } from '@modules/restaurants/domain/entities/restaurant-settings.entity';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { Table } from '@modules/tables/domain/entities/table.entity';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationSource } from '../../domain/enums/reservation.enums';
import { InvalidReservationTimeException } from '../../domain/exceptions/invalid-reservation-time.exception';
import { ReservationSlotOutcome } from '../dto/reservation-time-slots.result';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryBranchWorkingHoursRepository } from '../../../../../test/branches/support/in-memory-branch-working-hours.repository';
import { InMemoryWorkingHoursRepository } from '../../../../../test/restaurants/support/in-memory-working-hours.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryTableRepository } from '../../../../../test/tables/support/in-memory-table.repository';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';

describe('ListReservationTimeSlotsUseCase', () => {
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const tableId = '55555555-5555-4555-8555-555555555555';
  const now = new Date('2026-09-28T06:00:00.000Z');

  async function build() {
    const branchRepository = new InMemoryBranchRepository();
    const branchHoursRepository = new InMemoryBranchWorkingHoursRepository();
    const restaurantHoursRepository = new InMemoryWorkingHoursRepository();
    const settingsRepository = new InMemoryRestaurantSettingsRepository();
    const tableRepository = new InMemoryTableRepository();
    const reservationRepository = new InMemoryReservationRepository();
    await branchRepository.save(
      Branch.create({
        id: branchId,
        restaurantId,
        city: 'Damascus',
        district: null,
        address: '123 Main St',
        latitude: null,
        longitude: null,
        countryCode: 'SY',
        currency: null,
        timezone: 'Asia/Damascus',
        phone: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
    await settingsRepository.save(
      RestaurantSettings.createDefault('88888888-8888-4888-8888-888888888888', restaurantId, now),
    );
    await tableRepository.save(
      Table.create({
        id: tableId,
        branchId,
        floorPlanId: '99999999-9999-4999-8999-999999999999',
        floorPlanAreaId: null,
        tableNumber: 'T1',
        capacity: 4,
        floor: null,
        positionX: null,
        positionY: null,
        width: null,
        height: null,
        rotation: null,
        shape: TableShape.Rectangle,
        color: null,
        layer: null,
        indoor: true,
        vip: false,
        smoking: false,
        status: TableStatus.Available,
        mergeGroupId: null,
        isMergePrimary: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
    const useCase = new ListReservationTimeSlotsUseCase(
      branchRepository,
      new ListBranchWorkingHoursByBranchIdsUseCase(branchHoursRepository),
      new ListWorkingHoursByRestaurantIdsUseCase(restaurantHoursRepository),
      settingsRepository,
      tableRepository,
      reservationRepository,
      { now: () => now },
    );
    return {
      useCase,
      branchHoursRepository,
      restaurantHoursRepository,
      tableRepository,
      reservationRepository,
    };
  }

  it('steps the restaurant interval inside restaurant hours and returns only bookable windows', async () => {
    const { useCase, restaurantHoursRepository } = await build();
    await restaurantHoursRepository.replaceAllForRestaurant(RestaurantId.create(restaurantId), [
      WorkingHours.create({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        restaurantId,
        dayOfWeek: 1,
        openingTime: '18:00',
        closingTime: '22:00',
        breakStartTime: null,
        breakEndTime: null,
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    const result = await useCase.execute({ branchId, date: '2026-09-28', partySize: 4 });

    expect(result.outcome).toBe(ReservationSlotOutcome.Available);
    expect(result.intervalMinutes).toBe(30);
    expect(result.durationMinutes).toBe(90);
    expect(result.slots.map((slot) => slot.startTime)).toEqual([
      '2026-09-28T15:00:00.000Z',
      '2026-09-28T15:30:00.000Z',
      '2026-09-28T16:00:00.000Z',
      '2026-09-28T16:30:00.000Z',
      '2026-09-28T17:00:00.000Z',
      '2026-09-28T17:30:00.000Z',
    ]);
    expect(result.slots[0].endTime).toBe('2026-09-28T16:30:00.000Z');
  });

  it('prefers the branch override and the client duration', async () => {
    const { useCase, branchHoursRepository, restaurantHoursRepository } = await build();
    await restaurantHoursRepository.replaceAllForRestaurant(RestaurantId.create(restaurantId), [
      WorkingHours.create({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        restaurantId,
        dayOfWeek: 1,
        openingTime: '18:00',
        closingTime: '23:00',
        breakStartTime: null,
        breakEndTime: null,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    await branchHoursRepository.replaceAllForBranch(BranchId.create(branchId), [
      BranchWorkingHours.create({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        branchId,
        dayOfWeek: 1,
        openingTime: '12:00',
        closingTime: '15:00',
        breakStartTime: null,
        breakEndTime: null,
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    const result = await useCase.execute({
      branchId,
      date: '2026-09-28',
      partySize: 4,
      durationMinutes: 90,
    });

    expect(result.slots.map((slot) => slot.startTime)).toEqual([
      '2026-09-28T09:00:00.000Z',
      '2026-09-28T09:30:00.000Z',
      '2026-09-28T10:00:00.000Z',
      '2026-09-28T10:30:00.000Z',
    ]);
  });

  it('reports CLOSED when that weekday has no working hours', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({ branchId, date: '2026-09-28', partySize: 4 });

    expect(result.outcome).toBe(ReservationSlotOutcome.Closed);
    expect(result.slots).toEqual([]);
    expect(result.openingTime).toBeNull();
  });

  it('reports NO_SUITABLE_TABLE when every fitting table is already reserved', async () => {
    const { useCase, restaurantHoursRepository, reservationRepository } = await build();
    await restaurantHoursRepository.replaceAllForRestaurant(RestaurantId.create(restaurantId), [
      WorkingHours.create({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        restaurantId,
        dayOfWeek: 1,
        openingTime: '18:00',
        closingTime: '22:00',
        breakStartTime: null,
        breakEndTime: null,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    reservationRepository.seed(
      Reservation.create({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        reservationGuestId: null,
        source: ReservationSource.Online,
        restaurantId,
        branchId,
        tableId,
        reservationDate: new Date('2026-09-28T00:00:00.000Z'),
        reservationStartTime: new Date('2026-09-28T15:00:00.000Z'),
        reservationEndTime: new Date('2026-09-28T19:00:00.000Z'),
        guests: 4,
        tableCapacity: 4,
        notes: null,
        createdBy: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        now,
      }),
    );

    const result = await useCase.execute({ branchId, date: '2026-09-28', partySize: 4 });

    expect(result.outcome).toBe(ReservationSlotOutcome.NoSuitableTable);
    expect(result.slots).toEqual([]);
  });

  it('keeps a later window when only the earlier one overlaps a Pending reservation', async () => {
    const { useCase, restaurantHoursRepository, reservationRepository } = await build();
    await restaurantHoursRepository.replaceAllForRestaurant(RestaurantId.create(restaurantId), [
      WorkingHours.create({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        restaurantId,
        dayOfWeek: 1,
        openingTime: '18:00',
        closingTime: '22:00',
        breakStartTime: null,
        breakEndTime: null,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    reservationRepository.seed(
      Reservation.create({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        reservationGuestId: null,
        source: ReservationSource.Online,
        restaurantId,
        branchId,
        tableId,
        reservationDate: new Date('2026-09-28T00:00:00.000Z'),
        reservationStartTime: new Date('2026-09-28T15:00:00.000Z'),
        reservationEndTime: new Date('2026-09-28T16:30:00.000Z'),
        guests: 4,
        tableCapacity: 4,
        notes: null,
        createdBy: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        now,
      }),
    );

    const result = await useCase.execute({ branchId, date: '2026-09-28', partySize: 4 });

    expect(result.slots.map((slot) => slot.startTime)).toEqual([
      '2026-09-28T16:30:00.000Z',
      '2026-09-28T17:00:00.000Z',
      '2026-09-28T17:30:00.000Z',
    ]);
  });

  it('ignores a Cleaning table', async () => {
    const { useCase, restaurantHoursRepository, tableRepository } = await build();
    await restaurantHoursRepository.replaceAllForRestaurant(RestaurantId.create(restaurantId), [
      WorkingHours.create({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        restaurantId,
        dayOfWeek: 1,
        openingTime: '18:00',
        closingTime: '22:00',
        breakStartTime: null,
        breakEndTime: null,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    await tableRepository.save(
      Table.create({
        id: tableId,
        branchId,
        floorPlanId: '99999999-9999-4999-8999-999999999999',
        floorPlanAreaId: null,
        tableNumber: 'T1',
        capacity: 4,
        floor: null,
        positionX: null,
        positionY: null,
        width: null,
        height: null,
        rotation: null,
        shape: TableShape.Rectangle,
        color: null,
        layer: null,
        indoor: true,
        vip: false,
        smoking: false,
        status: TableStatus.Cleaning,
        mergeGroupId: null,
        isMergePrimary: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );

    const result = await useCase.execute({ branchId, date: '2026-09-28', partySize: 4 });

    expect(result.outcome).toBe(ReservationSlotOutcome.NoSuitableTable);
  });

  it('throws when the branch does not exist', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        branchId: '55555555-5555-4555-8555-555555555556',
        date: '2026-09-28',
        partySize: 4,
      }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });

  it('rejects a date that is not a real calendar day', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ branchId, date: '2026-02-31', partySize: 4 }),
    ).rejects.toBeInstanceOf(InvalidReservationTimeException);
  });

  it('rejects a calendar date before today in the branch timezone', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ branchId, date: '2026-09-27', partySize: 4 }),
    ).rejects.toBeInstanceOf(InvalidReservationTimeException);
  });

  it('rejects a party larger than the restaurant maximum', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ branchId, date: '2026-09-28', partySize: 21 }),
    ).rejects.toBeInstanceOf(InvalidReservationTimeException);
  });
});
