import { ApproveReservationUseCase } from './approve-reservation.use-case';
import { AutoRejectOverlappingPendingReservationsService } from '../services/auto-reject-overlapping-pending-reservations.service';
import { InMemoryReservationExpirationScheduler } from '../../../../../test/reservations/support/in-memory-reservation-expiration-scheduler';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationStatus } from '../../domain/enums/reservation.enums';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';
import { InvalidReservationStatusTransitionException } from '../../domain/exceptions/invalid-reservation-status-transition.exception';
import { ReservationConflictException } from '../../domain/exceptions/reservation-conflict.exception';
import {
  ReservationApprovedEvent,
  ReservationRejectedEvent,
} from '../../domain/events/reservation.events';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
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

describe('ApproveReservationUseCase', () => {
  const fixedNow = new Date('2026-08-01T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const otherBranchId = '99999999-9999-4999-8999-999999999991';
  const tableId = '55555555-5555-4555-8555-555555555555';
  const reservationId = '66666666-6666-4666-8666-666666666666';
  const otherPendingId = '77777777-7777-4777-8777-777777777777';

  function employeeActor(overrides?: Partial<{ branchIds: string[]; employeeId: string }>) {
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
      permissions: ['reservations:approve'],
      permissionsVersion: 1,
    };
  }

  function pendingReservation(overrides?: {
    id?: string;
    startTime?: string;
    endTime?: string;
    restaurantId?: string;
    branchId?: string;
    notes?: string | null;
  }) {
    const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    return Reservation.create({
      id: overrides?.id ?? reservationId,
      userId: customerId,
      restaurantId: overrides?.restaurantId ?? restaurantId,
      branchId: overrides?.branchId ?? branchId,
      tableId,
      reservationDate: new Date('2026-08-01T00:00:00.000Z'),
      reservationStartTime: new Date(overrides?.startTime ?? '2026-08-01T18:00:00.000Z'),
      reservationEndTime: new Date(overrides?.endTime ?? '2026-08-01T19:30:00.000Z'),
      guests: 2,
      tableCapacity: 4,
      notes: overrides?.notes ?? null,
      createdBy: customerId,
      now: fixedNow,
    });
  }

  async function build() {
    const reservationRepository = new InMemoryReservationRepository();
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
    const useCase = new ApproveReservationUseCase(
      reservationRepository,
      tableRepository,
      restaurantSettingsRepository,
      new FixedClock(new Date('2026-08-01T11:00:00.000Z')),
      new SequentialIdGenerator([
        'aaaaaaaa-0001-4000-8000-000000000001',
        'aaaaaaaa-0001-4000-8000-000000000002',
        'aaaaaaaa-0001-4000-8000-000000000003',
        'aaaaaaaa-0001-4000-8000-000000000004',
        'aaaaaaaa-0001-4000-8000-000000000005',
        'aaaaaaaa-0001-4000-8000-000000000006',
      ]),
      eventPublisher,
      new ImmediateUnitOfWork(),
      expirationScheduler,
      new AutoRejectOverlappingPendingReservationsService(reservationRepository),
    );

    return { useCase, reservationRepository, tableRepository, eventPublisher, expirationScheduler };
  }

  it('approves a Pending reservation, records approvedBy/approvedAt, and reserves the table', async () => {
    const { useCase, reservationRepository, tableRepository } = await build();
    await reservationRepository.seed(pendingReservation());

    const result = await useCase.execute({ actor: employeeActor(), reservationId });

    expect(result.status).toBe('Approved');
    expect(result.approvedBy).toBe('employee-1');
    expect(result.approvedAt).toEqual(new Date('2026-08-01T11:00:00.000Z'));

    const table = await tableRepository.findById(TableId.create(tableId));
    expect(table?.status).toBe(TableStatus.Reserved);
  });

  it('publishes ReservationApproved with automatic: false and the approving employeeId', async () => {
    const { useCase, reservationRepository, eventPublisher } = await build();
    await reservationRepository.seed(pendingReservation());

    await useCase.execute({ actor: employeeActor(), reservationId });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as ReservationApprovedEvent;
    expect(event).toBeInstanceOf(ReservationApprovedEvent);
    expect(event.payload).toMatchObject({
      reservationId,
      approvedBy: 'employee-1',
      automatic: false,
    });
  });

  it('throws ReservationNotFoundException for an unknown reservation', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: employeeActor(),
        reservationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      }),
    ).rejects.toBeInstanceOf(ReservationNotFoundException);
  });

  it('throws ReservationNotFoundException (IDOR) for a reservation belonging to a different restaurant', async () => {
    const { useCase, reservationRepository } = await build();
    await reservationRepository.seed(
      pendingReservation({ restaurantId: '11111111-1111-4111-8111-111111111199' }),
    );

    await expect(useCase.execute({ actor: employeeActor(), reservationId })).rejects.toBeInstanceOf(
      ReservationNotFoundException,
    );
  });

  it('throws EmployeeBranchNotAssignedException when the Employee is scoped to a different branch', async () => {
    const { useCase, reservationRepository } = await build();
    await reservationRepository.seed(pendingReservation());

    await expect(
      useCase.execute({
        actor: employeeActor({ branchIds: [otherBranchId] }),
        reservationId,
      }),
    ).rejects.toBeInstanceOf(EmployeeBranchNotAssignedException);
  });

  it('allows an Employee with restaurant-wide scope (empty branchIds) to approve', async () => {
    const { useCase, reservationRepository } = await build();
    await reservationRepository.seed(pendingReservation());

    const result = await useCase.execute({
      actor: employeeActor({ branchIds: [] }),
      reservationId,
    });
    expect(result.status).toBe('Approved');
  });

  it('allows an Employee explicitly assigned to the reservation branch to approve', async () => {
    const { useCase, reservationRepository } = await build();
    await reservationRepository.seed(pendingReservation());

    const result = await useCase.execute({
      actor: employeeActor({ branchIds: [branchId] }),
      reservationId,
    });
    expect(result.status).toBe('Approved');
  });

  it.each([
    ReservationStatus.Approved,
    ReservationStatus.Rejected,
    ReservationStatus.Cancelled,
    ReservationStatus.Completed,
    ReservationStatus.Expired,
    ReservationStatus.NoShow,
  ])(
    'throws InvalidReservationStatusTransitionException approving a reservation already %s',
    async (status) => {
      const { useCase, reservationRepository } = await build();
      const reservation = pendingReservation();
      reservationRepository.seed(Reservation.reconstitute({ ...reservation.toProps(), status }));

      await expect(
        useCase.execute({ actor: employeeActor(), reservationId }),
      ).rejects.toBeInstanceOf(InvalidReservationStatusTransitionException);
    },
  );

  it('throws ReservationConflictException when a confirmed reservation already overlaps the table/window', async () => {
    const { useCase, reservationRepository } = await build();
    await reservationRepository.seed(pendingReservation());
    await reservationRepository.seed(
      Reservation.reconstitute({
        ...pendingReservation({
          id: '12121212-1212-4212-8212-121212121212',
          startTime: '2026-08-01T18:30:00.000Z',
          endTime: '2026-08-01T20:00:00.000Z',
        }).toProps(),
        status: ReservationStatus.Approved,
      }),
    );

    await expect(useCase.execute({ actor: employeeActor(), reservationId })).rejects.toBeInstanceOf(
      ReservationConflictException,
    );
  });

  it('auto-rejects another overlapping Pending reservation without touching the Table', async () => {
    const { useCase, reservationRepository, eventPublisher } = await build();
    await reservationRepository.seed(pendingReservation());
    await reservationRepository.seed(
      pendingReservation({
        id: otherPendingId,
        startTime: '2026-08-01T18:30:00.000Z',
        endTime: '2026-08-01T20:00:00.000Z',
      }),
    );

    await useCase.execute({ actor: employeeActor(), reservationId });

    const otherReservation = await reservationRepository.findById(
      ReservationId.create(otherPendingId),
    );
    expect(otherReservation?.status).toBe(ReservationStatus.Rejected);
    expect(otherReservation?.notes).toMatch(/Automatically rejected/);

    const rejectedEvent = eventPublisher.events.find(
      (event) => event instanceof ReservationRejectedEvent,
    ) as ReservationRejectedEvent;
    expect(rejectedEvent).toBeDefined();
    expect(rejectedEvent.payload).toMatchObject({
      reservationId: otherPendingId,
      rejectedBy: null,
      automatic: true,
    });
  });

  it('does not auto-reject a Pending reservation for a different table', async () => {
    const { useCase, reservationRepository } = await build();
    await reservationRepository.seed(pendingReservation());
    const differentTableId = '22222222-2222-4222-8222-222222222299';
    await reservationRepository.seed(
      Reservation.reconstitute({
        ...pendingReservation({
          id: otherPendingId,
          startTime: '2026-08-01T18:30:00.000Z',
          endTime: '2026-08-01T20:00:00.000Z',
        }).toProps(),
        tableId: differentTableId,
      }),
    );

    await useCase.execute({ actor: employeeActor(), reservationId });

    const other = await reservationRepository.findById(ReservationId.create(otherPendingId));
    expect(other?.status).toBe(ReservationStatus.Pending);
  });

  it('acquires the ADR-013 advisory lock before approving', async () => {
    const { useCase, reservationRepository } = await build();
    await reservationRepository.seed(pendingReservation());

    await useCase.execute({ actor: employeeActor(), reservationId });

    expect(reservationRepository.acquiredLockKeys).toHaveLength(1);
  });
});
