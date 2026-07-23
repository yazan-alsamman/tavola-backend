import { RescheduleReservationUseCase } from './reschedule-reservation.use-case';
import { AutoRejectOverlappingPendingReservationsService } from '../services/auto-reject-overlapping-pending-reservations.service';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationStatus } from '../../domain/enums/reservation.enums';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';
import { InvalidReservationException } from '../../domain/exceptions/invalid-reservation.exception';
import { InvalidReservationStatusTransitionException } from '../../domain/exceptions/invalid-reservation-status-transition.exception';
import { ReservationConflictException } from '../../domain/exceptions/reservation-conflict.exception';
import { ReservationRescheduleWindowExpiredException } from '../../domain/exceptions/reservation-reschedule-window-expired.exception';
import { TableNotFoundException } from '@modules/tables/domain/exceptions/table-not-found.exception';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import {
  ReservationRejectedEvent,
  ReservationRescheduledEvent,
} from '../../domain/events/reservation.events';
import { Table } from '@modules/tables/domain/entities/table.entity';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';
import { RestaurantSettings } from '@modules/restaurants/domain/entities/restaurant-settings.entity';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { ReservationId, TableId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryTableRepository } from '../../../../../test/tables/support/in-memory-table.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';
import { InMemoryReservationHistoryRepository } from '../../../../../test/reservations/support/in-memory-reservation-history.repository';
import { InMemoryReservationExpirationScheduler } from '../../../../../test/reservations/support/in-memory-reservation-expiration-scheduler';

describe('RescheduleReservationUseCase', () => {
  const creationTime = new Date('2026-07-25T10:00:00.000Z');
  const withinLeadTimeClock = new Date('2026-07-26T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const otherBranchId = '99999999-9999-4999-8999-999999999991';
  const tableId = '55555555-5555-4555-8555-555555555555';
  const otherTableId = '55555555-5555-4555-8555-555555555556';
  const crossBranchTableId = '55555555-5555-4555-8555-555555555557';
  const reservationId = '66666666-6666-4666-8666-666666666666';
  const otherPendingReservationId = '66666666-6666-4666-8666-666666666667';
  const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const otherCustomerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const startTime = new Date('2026-08-01T18:00:00.000Z');
  const endTime = new Date('2026-08-01T19:30:00.000Z');

  function userActor(userId: string = customerId) {
    return {
      actorType: AccessTokenActorType.User as const,
      userId,
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
    };
  }

  function employeeActor(overrides?: { branchIds?: string[] }) {
    return {
      actorType: AccessTokenActorType.Employee as const,
      userId: 'user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      employeeId: 'employee-1',
      organizationId: 'org-1',
      restaurantId,
      branchIds: overrides?.branchIds ?? [],
      permissions: ['reservations:reschedule'],
      permissionsVersion: 1,
    };
  }

  function reservation(overrides?: {
    status?: ReservationStatus;
    id?: string;
    tableId?: string;
    userId?: string;
  }) {
    const created = Reservation.create({
      id: overrides?.id ?? reservationId,
      userId: overrides?.userId ?? customerId,
      restaurantId,
      branchId,
      tableId: overrides?.tableId ?? tableId,
      reservationDate: new Date('2026-08-01T00:00:00.000Z'),
      reservationStartTime: startTime,
      reservationEndTime: endTime,
      guests: 2,
      tableCapacity: 4,
      notes: null,
      createdBy: overrides?.userId ?? customerId,
      now: creationTime,
    });
    return overrides?.status
      ? Reservation.reconstitute({ ...created.toProps(), status: overrides.status })
      : created;
  }

  function table(id: string, branch: string, status: TableStatus) {
    return Table.create({
      id,
      branchId: branch,
      floorPlanId: '88888888-8888-4888-8888-888888888888',
      tableNumber: `T-${id.slice(-1)}`,
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
      createdAt: creationTime,
      updatedAt: creationTime,
      deletedAt: null,
    });
  }

  async function build(clockAt: Date) {
    const reservationRepository = new InMemoryReservationRepository();
    const reservationHistoryRepository = new InMemoryReservationHistoryRepository();
    const tableRepository = new InMemoryTableRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const expirationScheduler = new InMemoryReservationExpirationScheduler();

    await restaurantSettingsRepository.save(
      RestaurantSettings.createDefault('settings-1', restaurantId, creationTime),
    );
    await tableRepository.save(table(tableId, branchId, TableStatus.Available));
    await tableRepository.save(table(otherTableId, branchId, TableStatus.Available));
    await tableRepository.save(table(crossBranchTableId, otherBranchId, TableStatus.Available));

    const eventPublisher = new CollectingEventPublisher();
    const autoRejectOverlappingPendingReservations =
      new AutoRejectOverlappingPendingReservationsService(reservationRepository);
    const useCase = new RescheduleReservationUseCase(
      reservationRepository,
      reservationHistoryRepository,
      tableRepository,
      restaurantSettingsRepository,
      new FixedClock(clockAt),
      new SequentialIdGenerator([
        'aaaaaaaa-0006-4000-8000-000000000001',
        'aaaaaaaa-0006-4000-8000-000000000002',
        'aaaaaaaa-0006-4000-8000-000000000003',
        'aaaaaaaa-0006-4000-8000-000000000004',
      ]),
      eventPublisher,
      new ImmediateUnitOfWork(),
      expirationScheduler,
      autoRejectOverlappingPendingReservations,
    );

    return {
      useCase,
      reservationRepository,
      reservationHistoryRepository,
      tableRepository,
      restaurantSettingsRepository,
      eventPublisher,
      expirationScheduler,
    };
  }

  describe('Pending reschedule', () => {
    it('reschedules a Pending reservation to a new time on the same table - no Table operation', async () => {
      const { useCase, reservationRepository, tableRepository, reservationHistoryRepository } =
        await build(withinLeadTimeClock);
      await reservationRepository.seed(reservation());

      const result = await useCase.execute({
        actor: userActor(),
        reservationId,
        reservationStartTime: '2026-08-02T18:00:00.000Z',
        reservationEndTime: '2026-08-02T19:30:00.000Z',
      });

      expect(result.status).toBe('Pending');
      expect(result.reservationStartTime).toEqual(new Date('2026-08-02T18:00:00.000Z'));
      const originalTable = await tableRepository.findById(TableId.create(tableId));
      expect(originalTable?.status).toBe(TableStatus.Available);
      expect(reservationHistoryRepository.rows[0]).toMatchObject({
        oldStatus: ReservationStatus.Pending,
        newStatus: ReservationStatus.Pending,
        oldTableId: null,
        newTableId: null,
      });
    });

    it('reschedules a Pending reservation to a different table - still no Table operation', async () => {
      const { useCase, reservationRepository, tableRepository } = await build(withinLeadTimeClock);
      await reservationRepository.seed(reservation());

      const result = await useCase.execute({
        actor: userActor(),
        reservationId,
        tableId: otherTableId,
      });

      expect(result.tableId).toBe(otherTableId);
      const newTable = await tableRepository.findById(TableId.create(otherTableId));
      expect(newTable?.status).toBe(TableStatus.Available);
    });

    it('acquires only the single new-window lock key for a Pending reschedule', async () => {
      const { useCase, reservationRepository } = await build(withinLeadTimeClock);
      await reservationRepository.seed(reservation());

      await useCase.execute({ actor: userActor(), reservationId, tableId: otherTableId });

      expect(reservationRepository.acquiredLockKeys).toHaveLength(1);
    });

    it('reschedules the pending-expiration job to the new start time', async () => {
      const { useCase, reservationRepository, expirationScheduler } =
        await build(withinLeadTimeClock);
      await reservationRepository.seed(reservation());

      await useCase.execute({
        actor: userActor(),
        reservationId,
        reservationStartTime: '2026-08-02T18:00:00.000Z',
        reservationEndTime: '2026-08-02T19:30:00.000Z',
      });

      const scheduled = expirationScheduler.scheduled.get(reservationId);
      expect(scheduled?.expireAt).toEqual(new Date('2026-08-02T18:15:00.000Z'));
    });

    it('does not auto-reject overlapping Pending reservations for a Pending reschedule', async () => {
      const { useCase, reservationRepository, eventPublisher } = await build(withinLeadTimeClock);
      await reservationRepository.seed(reservation());
      await reservationRepository.seed(
        reservation({
          id: otherPendingReservationId,
          userId: otherCustomerId,
          tableId: otherTableId,
        }),
      );

      await useCase.execute({ actor: userActor(), reservationId, tableId: otherTableId });

      const untouched = await reservationRepository.findById(
        ReservationId.create(otherPendingReservationId),
      );
      expect(untouched?.status).toBe(ReservationStatus.Pending);
      expect(eventPublisher.events).toHaveLength(1);
      expect(eventPublisher.events[0]).toBeInstanceOf(ReservationRescheduledEvent);
    });
  });

  describe('Approved reschedule', () => {
    async function seedApproved(repos: Awaited<ReturnType<typeof build>>) {
      await repos.reservationRepository.seed(reservation({ status: ReservationStatus.Approved }));
      await repos.tableRepository.save(
        (await repos.tableRepository.findById(TableId.create(tableId)))!.reserve(
          reservationId,
          creationTime,
        ),
      );
    }

    it('keeps the table continuously Reserved for a same-table Approved reschedule', async () => {
      const repos = await build(withinLeadTimeClock);
      await seedApproved(repos);

      const result = await repos.useCase.execute({
        actor: userActor(),
        reservationId,
        reservationStartTime: '2026-08-02T18:00:00.000Z',
        reservationEndTime: '2026-08-02T19:30:00.000Z',
      });

      expect(result.status).toBe('Approved');
      const sameTable = await repos.tableRepository.findById(TableId.create(tableId));
      expect(sameTable?.status).toBe(TableStatus.Reserved);
      expect(repos.reservationRepository.acquiredLockKeys).toHaveLength(1);
    });

    it('releases the old Table and reserves the new one for a cross-table Approved reschedule', async () => {
      const repos = await build(withinLeadTimeClock);
      await seedApproved(repos);

      const result = await repos.useCase.execute({
        actor: userActor(),
        reservationId,
        tableId: otherTableId,
      });

      expect(result.tableId).toBe(otherTableId);
      const oldTable = await repos.tableRepository.findById(TableId.create(tableId));
      const newTable = await repos.tableRepository.findById(TableId.create(otherTableId));
      expect(oldTable?.status).toBe(TableStatus.Available);
      expect(newTable?.status).toBe(TableStatus.Reserved);
    });

    it('acquires both the old and new lock keys, in deterministic sorted order, for a cross-table Approved reschedule', async () => {
      const repos = await build(withinLeadTimeClock);
      await seedApproved(repos);

      await repos.useCase.execute({ actor: userActor(), reservationId, tableId: otherTableId });

      expect(repos.reservationRepository.acquiredLockKeys).toHaveLength(2);
      const [first, second] = repos.reservationRepository.acquiredLockKeys;
      expect([first, second]).toEqual([...[first, second]].sort());
    });

    it('auto-rejects another overlapping Pending reservation on the new table', async () => {
      const repos = await build(withinLeadTimeClock);
      await seedApproved(repos);
      await repos.reservationRepository.seed(
        reservation({
          id: otherPendingReservationId,
          userId: otherCustomerId,
          tableId: otherTableId,
        }),
      );

      await repos.useCase.execute({ actor: userActor(), reservationId, tableId: otherTableId });

      const rejected = await repos.reservationRepository.findById(
        ReservationId.create(otherPendingReservationId),
      );
      expect(rejected?.status).toBe(ReservationStatus.Rejected);
      const rejectedEvent = repos.eventPublisher.events.find(
        (event) => event instanceof ReservationRejectedEvent,
      ) as ReservationRejectedEvent;
      expect(rejectedEvent.payload).toMatchObject({
        reservationId: otherPendingReservationId,
        automatic: true,
      });
    });

    it('rejects a cross-table reschedule when the target window is already confirmed-occupied', async () => {
      const repos = await build(withinLeadTimeClock);
      await seedApproved(repos);
      const conflictingId = '66666666-6666-4666-8666-666666666668';
      await repos.reservationRepository.seed(
        reservation({
          id: conflictingId,
          userId: otherCustomerId,
          tableId: otherTableId,
          status: ReservationStatus.Approved,
        }),
      );

      await expect(
        repos.useCase.execute({ actor: userActor(), reservationId, tableId: otherTableId }),
      ).rejects.toBeInstanceOf(ReservationConflictException);
    });
  });

  it('rejects a target table belonging to a different Branch', async () => {
    const { useCase, reservationRepository } = await build(withinLeadTimeClock);
    await reservationRepository.seed(reservation());

    await expect(
      useCase.execute({ actor: userActor(), reservationId, tableId: crossBranchTableId }),
    ).rejects.toBeInstanceOf(TableNotFoundException);
  });

  it('rejects reschedule once the cancellation window before the current time has closed', async () => {
    const { useCase, reservationRepository } = await build(new Date('2026-08-01T17:30:00.000Z'));
    await reservationRepository.seed(reservation());

    await expect(
      useCase.execute({ actor: userActor(), reservationId, tableId: otherTableId }),
    ).rejects.toBeInstanceOf(ReservationRescheduleWindowExpiredException);
  });

  it('requires at least one of tableId/reservationStartTime/reservationEndTime/guests', async () => {
    const { useCase, reservationRepository } = await build(withinLeadTimeClock);
    await reservationRepository.seed(reservation());

    await expect(useCase.execute({ actor: userActor(), reservationId })).rejects.toBeInstanceOf(
      InvalidReservationException,
    );
  });

  it("prevents a Customer from rescheduling another Customer's reservation (IDOR)", async () => {
    const { useCase, reservationRepository } = await build(withinLeadTimeClock);
    await reservationRepository.seed(reservation());

    await expect(
      useCase.execute({
        actor: userActor(otherCustomerId),
        reservationId,
        tableId: otherTableId,
      }),
    ).rejects.toBeInstanceOf(ReservationNotFoundException);
  });

  it('allows a branch-scoped Employee with reservations:reschedule to reschedule', async () => {
    const { useCase, reservationRepository } = await build(withinLeadTimeClock);
    await reservationRepository.seed(reservation());

    const result = await useCase.execute({
      actor: employeeActor({ branchIds: [branchId] }),
      reservationId,
      tableId: otherTableId,
    });

    expect(result.tableId).toBe(otherTableId);
  });

  it('rejects an Employee outside branch scope', async () => {
    const { useCase, reservationRepository } = await build(withinLeadTimeClock);
    await reservationRepository.seed(reservation());

    await expect(
      useCase.execute({
        actor: employeeActor({ branchIds: [otherBranchId] }),
        reservationId,
        tableId: otherTableId,
      }),
    ).rejects.toBeInstanceOf(EmployeeBranchNotAssignedException);
  });

  it('publishes ReservationRescheduled with the acting Customer id', async () => {
    const { useCase, reservationRepository, eventPublisher } = await build(withinLeadTimeClock);
    await reservationRepository.seed(reservation());

    await useCase.execute({ actor: userActor(), reservationId, tableId: otherTableId });

    const event = eventPublisher.events[0] as ReservationRescheduledEvent;
    expect(event).toBeInstanceOf(ReservationRescheduledEvent);
    expect(event.payload).toMatchObject({
      reservationId,
      oldTableId: tableId,
      newTableId: otherTableId,
      rescheduledBy: customerId,
    });
  });

  it('throws ReservationNotFoundException for an unknown reservation', async () => {
    const { useCase } = await build(withinLeadTimeClock);

    await expect(
      useCase.execute({
        actor: userActor(),
        reservationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        tableId: otherTableId,
      }),
    ).rejects.toBeInstanceOf(ReservationNotFoundException);
  });

  it.each([
    ReservationStatus.Rejected,
    ReservationStatus.Cancelled,
    ReservationStatus.Completed,
    ReservationStatus.Expired,
    ReservationStatus.NoShow,
  ])('rejects rescheduling a reservation that is already %s', async (status) => {
    const { useCase, reservationRepository } = await build(withinLeadTimeClock);
    await reservationRepository.seed(reservation({ status }));

    await expect(
      useCase.execute({ actor: userActor(), reservationId, tableId: otherTableId }),
    ).rejects.toBeInstanceOf(InvalidReservationStatusTransitionException);
  });
});
