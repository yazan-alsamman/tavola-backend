import { SearchAvailabilityUseCase } from './search-availability.use-case';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { Table } from '@modules/tables/domain/entities/table.entity';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';
import { RestaurantSettings } from '@modules/restaurants/domain/entities/restaurant-settings.entity';
import { Reservation } from '@modules/reservations/domain/entities/reservation.entity';
import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryTableRepository } from '../../../../../test/tables/support/in-memory-table.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';

describe('SearchAvailabilityUseCase', () => {
  const fixedNow = new Date('2026-08-01T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const availableTableId = '55555555-5555-4555-8555-555555555555';
  const smallTableId = '66666666-6666-4666-8666-666666666666';
  const disabledTableId = '77777777-7777-4777-8777-777777777777';

  async function build() {
    const branchRepository = new InMemoryBranchRepository();
    const tableRepository = new InMemoryTableRepository();
    const reservationRepository = new InMemoryReservationRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();

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
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );

    await restaurantSettingsRepository.save(
      RestaurantSettings.createDefault(
        '88888888-8888-4888-8888-888888888888',
        restaurantId,
        fixedNow,
      ),
    );

    function makeTable(id: string, capacity: number, status: TableStatus) {
      return Table.create({
        id,
        branchId,
        floorPlanId: '99999999-9999-4999-8999-999999999999',
        tableNumber: id.slice(0, 4),
        capacity,
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
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      });
    }

    await tableRepository.save(makeTable(availableTableId, 4, TableStatus.Available));
    await tableRepository.save(makeTable(smallTableId, 2, TableStatus.Available));
    await tableRepository.save(makeTable(disabledTableId, 4, TableStatus.Disabled));

    const useCase = new SearchAvailabilityUseCase(
      branchRepository,
      tableRepository,
      reservationRepository,
      restaurantSettingsRepository,
    );

    return { useCase, reservationRepository };
  }

  it('returns only Available-status tables with sufficient capacity', async () => {
    const { useCase } = await build();

    const results = await useCase.execute({
      branchId,
      reservationStartTime: '2026-08-01T18:00:00.000Z',
      partySize: 4,
    });

    expect(results).toHaveLength(1);
    expect(results[0].tableId).toBe(availableTableId);
    expect(results[0].isAvailable).toBe(true);
  });

  it('marks a table with an overlapping Pending reservation as unavailable, but still returns it', async () => {
    const { useCase, reservationRepository } = await build();

    reservationRepository.seed(
      Reservation.create({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        reservationGuestId: null,
        source: ReservationSource.Online,
        restaurantId,
        branchId,
        tableId: availableTableId,
        reservationDate: new Date('2026-08-01T00:00:00.000Z'),
        reservationStartTime: new Date('2026-08-01T18:00:00.000Z'),
        reservationEndTime: new Date('2026-08-01T19:30:00.000Z'),
        guests: 4,
        tableCapacity: 4,
        notes: null,
        createdBy: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        now: fixedNow,
      }),
    );

    const results = await useCase.execute({
      branchId,
      reservationStartTime: '2026-08-01T18:00:00.000Z',
      partySize: 4,
    });

    expect(results).toHaveLength(1);
    expect(results[0].tableId).toBe(availableTableId);
    expect(results[0].isAvailable).toBe(false);
  });

  it('derives the search window end time from the restaurant default duration when omitted', async () => {
    const { useCase } = await build();

    const results = await useCase.execute({
      branchId,
      reservationStartTime: '2026-08-01T18:00:00.000Z',
      partySize: 2,
    });

    // Both the 4-capacity and 2-capacity tables qualify for partySize 2.
    expect(results).toHaveLength(2);
  });

  it('throws BranchNotFoundException for an unknown branch', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        branchId: '99999999-9999-4999-8999-999999999998',
        reservationStartTime: '2026-08-01T18:00:00.000Z',
        partySize: 2,
      }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });
});
