import { BranchClosure } from '@modules/branches/domain/entities/branch-closure.entity';
import { InMemoryBranchClosureRepository } from '../../../../../test/branches/support/in-memory-branch-closure.repository';
import { InMemoryBookingEligibilityReader } from '../../../../../test/reservations/support/in-memory-booking-eligibility.reader';
import { ListReservationTimeSlotsUseCase } from './list-reservation-time-slots.use-case';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { BranchWorkingHours } from '@modules/branches/domain/entities/branch-working-hours.entity';
import { ListBranchWorkingHoursByBranchIdsUseCase } from '@modules/branches/application/use-cases/list-branch-working-hours-by-branch-ids.use-case';
import { RestaurantSettings } from '@modules/restaurants/domain/entities/restaurant-settings.entity';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { Table } from '@modules/tables/domain/entities/table.entity';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationSource } from '../../domain/enums/reservation.enums';
import { InvalidReservationTimeException } from '../../domain/exceptions/invalid-reservation-time.exception';
import { ReservationSlotOutcome } from '../dto/reservation-time-slots.result';
import { BranchOpeningHoursService } from '../services/branch-opening-hours.service';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryBranchWorkingHoursRepository } from '../../../../../test/branches/support/in-memory-branch-working-hours.repository';
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
    const closureRepository = new InMemoryBranchClosureRepository();
    const bookingEligibility = new InMemoryBookingEligibilityReader();
    const useCase = new ListReservationTimeSlotsUseCase(
      branchRepository,
      new BranchOpeningHoursService(
        new ListBranchWorkingHoursByBranchIdsUseCase(branchHoursRepository),
        closureRepository,
      ),
      settingsRepository,
      tableRepository,
      reservationRepository,
      { now: () => now },
      bookingEligibility,
    );
    return {
      useCase,
      closureRepository,
      bookingEligibility,
      settingsRepository,
      branchRepository,
      branchHoursRepository,
      tableRepository,
      reservationRepository,
    };
  }

  it('steps the restaurant interval inside restaurant hours and returns only bookable windows', async () => {
    const { useCase, branchHoursRepository } = await build();
    await branchHoursRepository.replaceAllForBranch(BranchId.create(branchId), [
      BranchWorkingHours.create({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        branchId,
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

  it('uses the branch hours and the client duration', async () => {
    const { useCase, branchHoursRepository } = await build();
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
    const { useCase, branchHoursRepository, reservationRepository } = await build();
    await branchHoursRepository.replaceAllForBranch(BranchId.create(branchId), [
      BranchWorkingHours.create({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        branchId,
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
    const { useCase, branchHoursRepository, reservationRepository } = await build();
    await branchHoursRepository.replaceAllForBranch(BranchId.create(branchId), [
      BranchWorkingHours.create({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        branchId,
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
    const { useCase, branchHoursRepository, tableRepository } = await build();
    await branchHoursRepository.replaceAllForBranch(BranchId.create(branchId), [
      BranchWorkingHours.create({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        branchId,
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

  describe('branch booking limits (ADR-053)', () => {
    async function withEveningHours() {
      const built = await build();
      await built.branchHoursRepository.replaceAllForBranch(BranchId.create(branchId), [
        BranchWorkingHours.create({
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          branchId,
          dayOfWeek: 1,
          openingTime: '18:00',
          closingTime: '22:00',
          breakStartTime: null,
          breakEndTime: null,
          createdAt: now,
          updatedAt: now,
        }),
      ]);
      return built;
    }

    async function setLimits(
      settingsRepository: InMemoryRestaurantSettingsRepository,
      limits: { minLeadTimeMinutes?: number; maxDaysAhead?: number; dailyGuestCap?: number },
    ) {
      const settings = await settingsRepository.findByRestaurantId(
        RestaurantId.create(restaurantId),
      );
      await settingsRepository.save(
        settings!.updateSettings(
          {
            reservationIntervalMinutes: settings!.reservationIntervalMinutes,
            maxGuestsPerReservation: settings!.maxGuestsPerReservation,
            cancellationWindowMinutes: settings!.cancellationWindowMinutes,
            pendingReservationTimeoutMinutes: settings!.pendingReservationTimeoutMinutes,
            defaultReservationDurationMinutes: settings!.defaultReservationDurationMinutes,
            autoApproval: settings!.autoApproval,
            timezone: settings!.timezone,
            defaultCurrency: settings!.defaultCurrency,
            reservationReminderMinutesBefore: settings!.reservationReminderMinutesBefore,
            lateArrivalGraceMinutes: settings!.lateArrivalGraceMinutes,
            ...limits,
          },
          now,
        ),
      );
    }

    it('reports CLOSED on a date a temporary closure covers', async () => {
      const { useCase, closureRepository } = await withEveningHours();
      await closureRepository.save(
        BranchClosure.create({
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          branchId,
          startDate: '2026-09-27',
          endDate: '2026-09-28',
          reason: 'Holiday',
          createdAt: now,
          updatedAt: now,
        }),
      );

      const result = await useCase.execute({ branchId, date: '2026-09-28', partySize: 4 });

      expect(result.outcome).toBe(ReservationSlotOutcome.Closed);
      expect(result.slots).toEqual([]);
    });

    it('reports CLOSED while the branch is paused', async () => {
      const { useCase, branchRepository } = await withEveningHours();
      const branch = await branchRepository.findById(BranchId.create(branchId));
      await branchRepository.save(branch!.pause(now));

      const result = await useCase.execute({ branchId, date: '2026-09-28', partySize: 4 });

      expect(result.outcome).toBe(ReservationSlotOutcome.Closed);
    });

    it('drops slots inside the minimum notice', async () => {
      const { useCase, settingsRepository } = await withEveningHours();
      // now is 09:00 local; 10 hours of notice leaves slots from 19:00 local.
      await setLimits(settingsRepository, { minLeadTimeMinutes: 600 });

      const result = await useCase.execute({ branchId, date: '2026-09-28', partySize: 4 });

      expect(result.slots[0].startTime).toBe('2026-09-28T16:30:00.000Z');
    });

    it('reports CLOSED past the branch booking window', async () => {
      const { useCase, settingsRepository } = await withEveningHours();
      await setLimits(settingsRepository, { maxDaysAhead: 6 });

      const result = await useCase.execute({ branchId, date: '2026-10-05', partySize: 4 });

      expect(result.outcome).toBe(ReservationSlotOutcome.Closed);
    });

    it('reports NO_REMAINING_SLOTS when the party would pass the daily guest cap', async () => {
      const { useCase, settingsRepository, bookingEligibility } = await withEveningHours();
      await setLimits(settingsRepository, { dailyGuestCap: 40 });
      bookingEligibility.branchGuestsBooked = 38;

      const result = await useCase.execute({ branchId, date: '2026-09-28', partySize: 4 });

      expect(result.outcome).toBe(ReservationSlotOutcome.NoRemainingSlots);
    });
  });
});
