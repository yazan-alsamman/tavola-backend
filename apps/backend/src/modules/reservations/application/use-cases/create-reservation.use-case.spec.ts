import { CreateReservationUseCase } from './create-reservation.use-case';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { TableNotFoundException } from '@modules/tables/domain/exceptions/table-not-found.exception';
import { TableUnavailableException } from '@modules/reservations/domain/exceptions/table-unavailable.exception';
import { PartySizeExceedsCapacityException } from '@modules/reservations/domain/exceptions/party-size-exceeds-capacity.exception';
import {
  ReservationApprovedEvent,
  ReservationCreatedEvent,
} from '@modules/reservations/domain/events/reservation.events';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { Table } from '@modules/tables/domain/entities/table.entity';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';
import { RestaurantSettings } from '@modules/restaurants/domain/entities/restaurant-settings.entity';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { BranchId, TableId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryTableRepository } from '../../../../../test/tables/support/in-memory-table.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';
import { InMemoryReservationExpirationScheduler } from '../../../../../test/reservations/support/in-memory-reservation-expiration-scheduler';

describe('CreateReservationUseCase', () => {
  const fixedNow = new Date('2026-08-01T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const tableId = '55555555-5555-4555-8555-555555555555';
  const reservationId = '66666666-6666-4666-8666-666666666666';

  function baseActor() {
    return {
      actorType: AccessTokenActorType.User as const,
      userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
    };
  }

  async function build(overrides?: {
    tableStatus?: TableStatus;
    tableCapacity?: number;
    autoApproval?: boolean;
  }) {
    const branchRepository = new InMemoryBranchRepository();
    const tableRepository = new InMemoryTableRepository();
    const reservationRepository = new InMemoryReservationRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const expirationScheduler = new InMemoryReservationExpirationScheduler();

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

    const defaultSettings = RestaurantSettings.createDefault(
      '77777777-7777-4777-8777-777777777777',
      restaurantId,
      fixedNow,
    );
    await restaurantSettingsRepository.save(
      overrides?.autoApproval
        ? defaultSettings.updateSettings(
            { ...defaultSettings.toProps(), autoApproval: true },
            fixedNow,
          )
        : defaultSettings,
    );

    await tableRepository.save(
      Table.create({
        id: tableId,
        branchId,
        floorPlanId: '88888888-8888-4888-8888-888888888888',
        tableNumber: 'T1',
        capacity: overrides?.tableCapacity ?? 4,
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
        status: overrides?.tableStatus ?? TableStatus.Available,
        mergeGroupId: null,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );

    const eventPublisher = new CollectingEventPublisher();
    const useCase = new CreateReservationUseCase(
      branchRepository,
      tableRepository,
      restaurantSettingsRepository,
      reservationRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([
        reservationId,
        '99999999-9999-4999-8999-999999999997',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
      ]),
      eventPublisher,
      new ImmediateUnitOfWork(),
      expirationScheduler,
    );

    return { useCase, reservationRepository, tableRepository, eventPublisher, expirationScheduler };
  }

  it('creates a Pending reservation with a client-supplied reservationEndTime', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({
      actor: baseActor(),
      branchId,
      tableId,
      reservationStartTime: '2026-08-01T18:00:00.000Z',
      reservationEndTime: '2026-08-01T20:00:00.000Z',
      guests: 4,
    });

    expect(result.status).toBe('Pending');
    expect(result.reservationEndTime.toISOString()).toBe('2026-08-01T20:00:00.000Z');
  });

  it('derives reservationEndTime from the restaurant default duration when omitted', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({
      actor: baseActor(),
      branchId,
      tableId,
      reservationStartTime: '2026-08-01T18:00:00.000Z',
      guests: 4,
    });

    // RestaurantSettings.createDefault's own default is 90 minutes.
    expect(result.reservationEndTime.toISOString()).toBe('2026-08-01T19:30:00.000Z');
  });

  it('publishes ReservationCreated', async () => {
    const { useCase, eventPublisher } = await build();

    await useCase.execute({
      actor: baseActor(),
      branchId,
      tableId,
      reservationStartTime: '2026-08-01T18:00:00.000Z',
      guests: 4,
    });

    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(ReservationCreatedEvent);
  });

  it('acquires the ADR-013 advisory lock before persisting', async () => {
    const { useCase, reservationRepository } = await build();

    await useCase.execute({
      actor: baseActor(),
      branchId,
      tableId,
      reservationStartTime: '2026-08-01T18:00:00.000Z',
      guests: 4,
    });

    expect(reservationRepository.acquiredLockKeys).toHaveLength(1);
  });

  it('throws BranchNotFoundException for an unknown branch', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: baseActor(),
        branchId: '99999999-9999-4999-8999-999999999999',
        tableId,
        reservationStartTime: '2026-08-01T18:00:00.000Z',
        guests: 4,
      }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });

  it('throws TableNotFoundException when the table belongs to a different branch (IDOR)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: baseActor(),
        branchId,
        tableId: '99999999-9999-4999-8999-999999999998',
        reservationStartTime: '2026-08-01T18:00:00.000Z',
        guests: 4,
      }),
    ).rejects.toBeInstanceOf(TableNotFoundException);
  });

  it('throws TableUnavailableException when the table is Disabled', async () => {
    const { useCase } = await build({ tableStatus: TableStatus.Disabled });

    await expect(
      useCase.execute({
        actor: baseActor(),
        branchId,
        tableId,
        reservationStartTime: '2026-08-01T18:00:00.000Z',
        guests: 4,
      }),
    ).rejects.toBeInstanceOf(TableUnavailableException);
  });

  it('throws PartySizeExceedsCapacityException when guests exceed table capacity', async () => {
    const { useCase } = await build({ tableCapacity: 2 });

    await expect(
      useCase.execute({
        actor: baseActor(),
        branchId,
        tableId,
        reservationStartTime: '2026-08-01T18:00:00.000Z',
        guests: 4,
      }),
    ).rejects.toBeInstanceOf(PartySizeExceedsCapacityException);
  });

  it('allows two overlapping Pending reservations for the same table to coexist', async () => {
    const { useCase } = await build();

    await useCase.execute({
      actor: baseActor(),
      branchId,
      tableId,
      reservationStartTime: '2026-08-01T18:00:00.000Z',
      guests: 4,
    });

    await expect(
      useCase.execute({
        actor: { ...baseActor(), userId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
        branchId,
        tableId,
        reservationStartTime: '2026-08-01T18:15:00.000Z',
        guests: 2,
      }),
    ).resolves.toBeDefined();
  });

  describe('auto-approval (Phase 7.2, RestaurantSettings.autoApproval = true)', () => {
    it('creates the reservation directly as Approved, never Pending', async () => {
      const { useCase } = await build({ autoApproval: true });

      const result = await useCase.execute({
        actor: baseActor(),
        branchId,
        tableId,
        reservationStartTime: '2026-08-01T18:00:00.000Z',
        guests: 4,
      });

      expect(result.status).toBe('Approved');
    });

    it('reserves the table atomically with the reservation insert', async () => {
      const { useCase, tableRepository } = await build({ autoApproval: true });

      await useCase.execute({
        actor: baseActor(),
        branchId,
        tableId,
        reservationStartTime: '2026-08-01T18:00:00.000Z',
        guests: 4,
      });

      const table = await tableRepository.findById(TableId.create(tableId));
      expect(table?.status).toBe(TableStatus.Reserved);
    });

    it('publishes only ReservationCreated, never a redundant ReservationApproved transition event', async () => {
      const { useCase, eventPublisher } = await build({ autoApproval: true });

      await useCase.execute({
        actor: baseActor(),
        branchId,
        tableId,
        reservationStartTime: '2026-08-01T18:00:00.000Z',
        guests: 4,
      });

      expect(eventPublisher.events).toHaveLength(1);
      expect(eventPublisher.events[0]).toBeInstanceOf(ReservationCreatedEvent);
      expect(eventPublisher.events.some((event) => event instanceof ReservationApprovedEvent)).toBe(
        false,
      );
    });

    it('when autoApproval is false (regression), still creates Pending and leaves the table Available', async () => {
      const { useCase, tableRepository } = await build({ autoApproval: false });

      const result = await useCase.execute({
        actor: baseActor(),
        branchId,
        tableId,
        reservationStartTime: '2026-08-01T18:00:00.000Z',
        guests: 4,
      });

      expect(result.status).toBe('Pending');
      const table = await tableRepository.findByIdAndBranchId(
        TableId.create(tableId),
        BranchId.create(branchId),
      );
      expect(table?.status).toBe(TableStatus.Available);
    });
  });
});
