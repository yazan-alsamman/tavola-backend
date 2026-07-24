import { CancelReservationUseCase } from './cancel-reservation.use-case';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationSource, ReservationStatus } from '../../domain/enums/reservation.enums';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';
import { InvalidReservationStatusTransitionException } from '../../domain/exceptions/invalid-reservation-status-transition.exception';
import { ReservationCancelledEvent } from '../../domain/events/reservation.events';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { Table } from '@modules/tables/domain/entities/table.entity';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';
import { RestaurantSettings } from '@modules/restaurants/domain/entities/restaurant-settings.entity';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { TableId } from '@shared/domain/value-objects/identifiers.vo';
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

describe('CancelReservationUseCase', () => {
  const fixedNow = new Date('2026-08-01T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const otherBranchId = '99999999-9999-4999-8999-999999999991';
  const tableId = '55555555-5555-4555-8555-555555555555';
  const reservationId = '66666666-6666-4666-8666-666666666666';
  const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const otherCustomerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  function userActor(userId: string = customerId) {
    return {
      actorType: AccessTokenActorType.User as const,
      userId,
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
    };
  }

  function employeeActor(overrides?: {
    branchIds?: string[];
    permissions?: string[];
    employeeId?: string;
  }) {
    return {
      actorType: AccessTokenActorType.Employee as const,
      userId: 'user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      employeeId: overrides?.employeeId ?? 'employee-1',
      organizationId: 'org-1',
      restaurantId,
      branchIds: overrides?.branchIds ?? [],
      permissions: overrides?.permissions ?? ['reservations:cancel'],
      permissionsVersion: 1,
    };
  }

  function reservation(overrides?: {
    status?: ReservationStatus;
    startTime?: string;
    endTime?: string;
  }) {
    const created = Reservation.create({
      id: reservationId,
      userId: customerId,
      reservationGuestId: null,
      source: ReservationSource.Online,
      restaurantId,
      branchId,
      tableId,
      reservationDate: new Date('2026-08-01T00:00:00.000Z'),
      reservationStartTime: new Date(overrides?.startTime ?? '2026-08-01T18:00:00.000Z'),
      reservationEndTime: new Date(overrides?.endTime ?? '2026-08-01T19:30:00.000Z'),
      guests: 2,
      tableCapacity: 4,
      notes: null,
      createdBy: customerId,
      now: fixedNow,
    });
    return overrides?.status
      ? Reservation.reconstitute({ ...created.toProps(), status: overrides.status })
      : created;
  }

  async function build() {
    const reservationRepository = new InMemoryReservationRepository();
    const reservationHistoryRepository = new InMemoryReservationHistoryRepository();
    const tableRepository = new InMemoryTableRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const expirationScheduler = new InMemoryReservationExpirationScheduler();

    await restaurantSettingsRepository.save(
      RestaurantSettings.createDefault('settings-1', restaurantId, fixedNow),
    );

    await tableRepository.save(
      Table.create({
        id: tableId,
        branchId,
        floorPlanId: '88888888-8888-4888-8888-888888888888',
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
        status: TableStatus.Available,
        mergeGroupId: null,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );

    const eventPublisher = new CollectingEventPublisher();
    const useCase = new CancelReservationUseCase(
      reservationRepository,
      reservationHistoryRepository,
      tableRepository,
      restaurantSettingsRepository,
      new FixedClock(new Date('2026-08-01T11:00:00.000Z')),
      new SequentialIdGenerator([
        'aaaaaaaa-0002-4000-8000-000000000001',
        'aaaaaaaa-0002-4000-8000-000000000002',
      ]),
      eventPublisher,
      new ImmediateUnitOfWork(),
      expirationScheduler,
    );

    return {
      useCase,
      reservationRepository,
      reservationHistoryRepository,
      tableRepository,
      eventPublisher,
      expirationScheduler,
    };
  }

  it('allows the owning Customer to cancel their own Pending reservation - no Table operation', async () => {
    const { useCase, reservationRepository, tableRepository, reservationHistoryRepository } =
      await build();
    await reservationRepository.seed(reservation());

    const result = await useCase.execute({
      actor: userActor(),
      reservationId,
      reason: null,
    });

    expect(result.status).toBe('Cancelled');
    const table = await tableRepository.findById(TableId.create(tableId));
    expect(table?.status).toBe(TableStatus.Available);
    expect(reservationHistoryRepository.rows).toHaveLength(1);
    expect(reservationHistoryRepository.rows[0].newStatus).toBe(ReservationStatus.Cancelled);
  });

  it('allows the owning Customer to cancel their own Approved reservation - releases the Table', async () => {
    const { useCase, reservationRepository, tableRepository } = await build();
    await reservationRepository.seed(reservation({ status: ReservationStatus.Approved }));
    await tableRepository.save(
      (await tableRepository.findById(TableId.create(tableId)))!.reserve(reservationId, fixedNow),
    );

    const result = await useCase.execute({ actor: userActor(), reservationId, reason: null });

    expect(result.status).toBe('Cancelled');
    const table = await tableRepository.findById(TableId.create(tableId));
    expect(table?.status).toBe(TableStatus.Available);
  });

  it("prevents a Customer from cancelling another Customer's reservation (IDOR)", async () => {
    const { useCase, reservationRepository } = await build();
    await reservationRepository.seed(reservation());

    await expect(
      useCase.execute({ actor: userActor(otherCustomerId), reservationId, reason: null }),
    ).rejects.toBeInstanceOf(ReservationNotFoundException);
  });

  it('allows a branch-scoped Employee with reservations:cancel to cancel', async () => {
    const { useCase, reservationRepository } = await build();
    await reservationRepository.seed(reservation());

    const result = await useCase.execute({
      actor: employeeActor({ branchIds: [branchId] }),
      reservationId,
      reason: null,
    });

    expect(result.status).toBe('Cancelled');
  });

  it('rejects an Employee without reservations:cancel', async () => {
    const { useCase, reservationRepository } = await build();
    await reservationRepository.seed(reservation());

    await expect(
      useCase.execute({
        actor: employeeActor({ permissions: ['reservations:approve'] }),
        reservationId,
        reason: null,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedException);
  });

  it('rejects an Employee outside branch scope', async () => {
    const { useCase, reservationRepository } = await build();
    await reservationRepository.seed(reservation());

    await expect(
      useCase.execute({
        actor: employeeActor({ branchIds: [otherBranchId] }),
        reservationId,
        reason: null,
      }),
    ).rejects.toBeInstanceOf(EmployeeBranchNotAssignedException);
  });

  it('still succeeds within the cancellation window, flagging ReservationHistory.withinCancellationWindow', async () => {
    const { useCase, reservationRepository, reservationHistoryRepository } = await build();
    // clock is fixed at 11:00; reservation starts at 11:30 - within the
    // default 60-minute cancellationWindow, yet Cancel must still succeed.
    await reservationRepository.seed(reservation({ startTime: '2026-08-01T11:30:00.000Z' }));

    const result = await useCase.execute({ actor: userActor(), reservationId, reason: null });

    expect(result.status).toBe('Cancelled');
    expect(reservationHistoryRepository.rows[0].withinCancellationWindow).toBe(true);
  });

  it('records withinCancellationWindow: false when well outside the window', async () => {
    const { useCase, reservationRepository, reservationHistoryRepository } = await build();
    await reservationRepository.seed(
      reservation({ startTime: '2026-08-05T18:00:00.000Z', endTime: '2026-08-05T19:30:00.000Z' }),
    );

    await useCase.execute({ actor: userActor(), reservationId, reason: null });

    expect(reservationHistoryRepository.rows[0].withinCancellationWindow).toBe(false);
  });

  it('cancels the pending-expiration job when cancelling a Pending reservation', async () => {
    const { useCase, reservationRepository, expirationScheduler } = await build();
    await reservationRepository.seed(reservation());

    await useCase.execute({ actor: userActor(), reservationId, reason: null });

    expect(expirationScheduler.cancelledReservationIds).toContain(reservationId);
  });

  it('publishes ReservationCancelled with the acting Customer id', async () => {
    const { useCase, reservationRepository, eventPublisher } = await build();
    await reservationRepository.seed(reservation());

    await useCase.execute({ actor: userActor(), reservationId, reason: 'Change of plans' });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as ReservationCancelledEvent;
    expect(event).toBeInstanceOf(ReservationCancelledEvent);
    expect(event.payload).toMatchObject({ reservationId, cancelledBy: customerId });
  });

  it('throws ReservationNotFoundException for an unknown reservation', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: userActor(),
        reservationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        reason: null,
      }),
    ).rejects.toBeInstanceOf(ReservationNotFoundException);
  });

  it.each([
    ReservationStatus.Rejected,
    ReservationStatus.Cancelled,
    ReservationStatus.Completed,
    ReservationStatus.Expired,
    ReservationStatus.NoShow,
  ])('rejects cancelling a reservation that is already %s', async (status) => {
    const { useCase, reservationRepository } = await build();
    await reservationRepository.seed(reservation({ status }));

    await expect(
      useCase.execute({ actor: userActor(), reservationId, reason: null }),
    ).rejects.toBeInstanceOf(InvalidReservationStatusTransitionException);
  });
});
