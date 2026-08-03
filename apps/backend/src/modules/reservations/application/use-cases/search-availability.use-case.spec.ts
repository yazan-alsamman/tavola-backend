import { SearchAvailabilityUseCase } from './search-availability.use-case';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { Table } from '@modules/tables/domain/entities/table.entity';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';
import { RestaurantSettings } from '@modules/restaurants/domain/entities/restaurant-settings.entity';
import { Reservation } from '@modules/reservations/domain/entities/reservation.entity';
import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';
import { BranchId, TableId } from '@shared/domain/value-objects/identifiers.vo';
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
        isMergePrimary: false,
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

    return { useCase, reservationRepository, tableRepository };
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

  it("reports the merge group effectiveCapacity (not the Primary's own capacity column) for a merged Primary table", async () => {
    const { useCase, tableRepository } = await build();
    const mergeGroupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const secondaryTableId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await tableRepository.save(
      Table.create({
        id: secondaryTableId,
        branchId,
        floorPlanId: '99999999-9999-4999-8999-999999999999',
        tableNumber: 'S001',
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
        status: TableStatus.Available,
        mergeGroupId: null,
        isMergePrimary: false,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );
    const primary = await tableRepository.findByIdAndBranchId(
      TableId.create(availableTableId),
      BranchId.create(branchId),
    );
    const secondary = await tableRepository.findByIdAndBranchId(
      TableId.create(secondaryTableId),
      BranchId.create(branchId),
    );
    await tableRepository.save(primary!.asMergePrimary(mergeGroupId, fixedNow));
    await tableRepository.save(secondary!.asMergeSecondary(mergeGroupId, fixedNow));

    // partySize 6 exceeds the Primary's own capacity column (4) but fits
    // the merge group's effectiveCapacity (4 + 4 = 8) - `capacity` in the
    // response must reflect that sum, matching why this table was even
    // eligible to be returned at all.
    const results = await useCase.execute({
      branchId,
      reservationStartTime: '2026-08-01T18:00:00.000Z',
      partySize: 6,
    });

    const primaryResult = results.find((r) => r.tableId === availableTableId);
    expect(primaryResult).toBeDefined();
    expect(primaryResult?.capacity).toBe(8);
  });

  describe('Phase 15 (Optimization): batched merge-group resolution', () => {
    async function seedMergeGroup(
      tableRepository: InMemoryTableRepository,
      opts: {
        primaryId: string;
        secondaryId: string;
        mergeGroupId: string;
        tableNumberPrefix: string;
      },
    ) {
      await tableRepository.save(
        Table.create({
          id: opts.primaryId,
          branchId,
          floorPlanId: '99999999-9999-4999-8999-999999999999',
          tableNumber: `${opts.tableNumberPrefix}-P`,
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
          status: TableStatus.Available,
          mergeGroupId: null,
          isMergePrimary: false,
          createdAt: fixedNow,
          updatedAt: fixedNow,
          deletedAt: null,
        }),
      );
      await tableRepository.save(
        Table.create({
          id: opts.secondaryId,
          branchId,
          floorPlanId: '99999999-9999-4999-8999-999999999999',
          tableNumber: `${opts.tableNumberPrefix}-S`,
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
          status: TableStatus.Available,
          mergeGroupId: null,
          isMergePrimary: false,
          createdAt: fixedNow,
          updatedAt: fixedNow,
          deletedAt: null,
        }),
      );
      const primary = await tableRepository.findByIdAndBranchId(
        TableId.create(opts.primaryId),
        BranchId.create(branchId),
      );
      const secondary = await tableRepository.findByIdAndBranchId(
        TableId.create(opts.secondaryId),
        BranchId.create(branchId),
      );
      await tableRepository.save(primary!.asMergePrimary(opts.mergeGroupId, fixedNow));
      await tableRepository.save(secondary!.asMergeSecondary(opts.mergeGroupId, fixedNow));
    }

    it('resolves multiple distinct merge groups in a single batched call, each with its own correct effectiveCapacity', async () => {
      const { useCase, tableRepository } = await build();
      await seedMergeGroup(tableRepository, {
        primaryId: 'aaaaaaaa-0000-4000-8000-000000000001',
        secondaryId: 'aaaaaaaa-0000-4000-8000-000000000002',
        mergeGroupId: 'aaaaaaaa-0000-4000-8000-00000000000a',
        tableNumberPrefix: 'GRPA',
      });
      await seedMergeGroup(tableRepository, {
        primaryId: 'bbbbbbbb-0000-4000-8000-000000000001',
        secondaryId: 'bbbbbbbb-0000-4000-8000-000000000002',
        mergeGroupId: 'bbbbbbbb-0000-4000-8000-00000000000b',
        tableNumberPrefix: 'GRPB',
      });

      const findManyByMergeGroupIdsSpy = jest.spyOn(tableRepository, 'findManyByMergeGroupIds');
      const findManyByMergeGroupIdSpy = jest.spyOn(tableRepository, 'findManyByMergeGroupId');

      const results = await useCase.execute({
        branchId,
        reservationStartTime: '2026-08-01T18:00:00.000Z',
        partySize: 6,
      });

      const groupAResult = results.find(
        (r) => r.tableId === 'aaaaaaaa-0000-4000-8000-000000000001',
      );
      const groupBResult = results.find(
        (r) => r.tableId === 'bbbbbbbb-0000-4000-8000-000000000001',
      );
      expect(groupAResult?.capacity).toBe(8);
      expect(groupBResult?.capacity).toBe(8);

      // Exactly two batched calls total for the whole request, regardless of
      // how many distinct merge groups are referenced: one inside
      // `findManyAvailableByBranchIdAndMinCapacity` (capacity filtering,
      // pre-existing) and one inside `SearchAvailabilityUseCase` itself
      // (capacity display, this fix) - both O(1) per request, neither O(N)
      // per table/group. Before this fix, the display step alone issued one
      // `findManyByMergeGroupId` call per merged table in the loop.
      expect(findManyByMergeGroupIdsSpy).toHaveBeenCalledTimes(2);
      expect(
        findManyByMergeGroupIdsSpy.mock.calls.some(
          ([ids]) =>
            (ids as string[]).includes('aaaaaaaa-0000-4000-8000-00000000000a') &&
            (ids as string[]).includes('bbbbbbbb-0000-4000-8000-00000000000b'),
        ),
      ).toBe(true);
      // The old per-group, per-table method must never be called anymore -
      // neither by the use case nor by the repository's own filtering step.
      expect(findManyByMergeGroupIdSpy).not.toHaveBeenCalled();
    });

    it('preserves result ordering (by tableNumber, matching the candidate list order) across unmerged and merged tables', async () => {
      const { useCase, tableRepository } = await build();
      await seedMergeGroup(tableRepository, {
        primaryId: 'aaaaaaaa-0000-4000-8000-000000000001',
        secondaryId: 'aaaaaaaa-0000-4000-8000-000000000002',
        mergeGroupId: 'aaaaaaaa-0000-4000-8000-00000000000a',
        tableNumberPrefix: '0AAA',
      });

      const results = await useCase.execute({
        branchId,
        reservationStartTime: '2026-08-01T18:00:00.000Z',
        partySize: 2,
      });

      const tableIds = results.map((r) => r.tableId);
      // The merge primary's tableNumber ('0AAA-P') sorts before the two
      // pre-existing unmerged tables ('5555'/'6666') - order must follow
      // tableNumber ascending exactly as before this refactor.
      expect(tableIds[0]).toBe('aaaaaaaa-0000-4000-8000-000000000001');
    });

    it('never returns a Merged secondary as its own availability row (secondary exclusion unchanged)', async () => {
      const { useCase, tableRepository } = await build();
      await seedMergeGroup(tableRepository, {
        primaryId: 'aaaaaaaa-0000-4000-8000-000000000001',
        secondaryId: 'aaaaaaaa-0000-4000-8000-000000000002',
        mergeGroupId: 'aaaaaaaa-0000-4000-8000-00000000000a',
        tableNumberPrefix: 'GRPC',
      });

      const results = await useCase.execute({
        branchId,
        reservationStartTime: '2026-08-01T18:00:00.000Z',
        partySize: 2,
      });

      expect(results.some((r) => r.tableId === 'aaaaaaaa-0000-4000-8000-000000000002')).toBe(false);
    });

    it('deduplicates a repeated mergeGroupId before calling the repository (multiple Available primaries would never share one groupId in practice, but the call must stay safe either way)', async () => {
      const { useCase, tableRepository } = await build();
      await seedMergeGroup(tableRepository, {
        primaryId: 'aaaaaaaa-0000-4000-8000-000000000001',
        secondaryId: 'aaaaaaaa-0000-4000-8000-000000000002',
        mergeGroupId: 'aaaaaaaa-0000-4000-8000-00000000000a',
        tableNumberPrefix: 'GRPD',
      });
      const findManyByMergeGroupIdsSpy = jest.spyOn(tableRepository, 'findManyByMergeGroupIds');

      await useCase.execute({
        branchId,
        reservationStartTime: '2026-08-01T18:00:00.000Z',
        partySize: 2,
      });

      const [calledWith] = findManyByMergeGroupIdsSpy.mock.calls[0] as [string[]];
      expect(calledWith).toEqual(['aaaaaaaa-0000-4000-8000-00000000000a']);
    });
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
