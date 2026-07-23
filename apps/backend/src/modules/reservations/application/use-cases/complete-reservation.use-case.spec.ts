import { CompleteReservationUseCase } from './complete-reservation.use-case';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationStatus } from '../../domain/enums/reservation.enums';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';
import { InvalidReservationStatusTransitionException } from '../../domain/exceptions/invalid-reservation-status-transition.exception';
import { InvalidReservationTimeException } from '../../domain/exceptions/invalid-reservation-time.exception';
import { ReservationCompletedEvent } from '../../domain/events/reservation.events';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { Table } from '@modules/tables/domain/entities/table.entity';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { TableId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryTableRepository } from '../../../../../test/tables/support/in-memory-table.repository';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';
import { InMemoryReservationHistoryRepository } from '../../../../../test/reservations/support/in-memory-reservation-history.repository';

describe('CompleteReservationUseCase', () => {
  const fixedNow = new Date('2026-08-01T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const otherBranchId = '99999999-9999-4999-8999-999999999991';
  const tableId = '55555555-5555-4555-8555-555555555555';
  const reservationId = '66666666-6666-4666-8666-666666666666';
  const startTime = new Date('2026-08-01T18:00:00.000Z');

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
      permissions: ['reservations:complete'],
      permissionsVersion: 1,
    };
  }

  function approvedReservation(overrides?: { status?: ReservationStatus }) {
    const created = Reservation.create({
      id: reservationId,
      userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      restaurantId,
      branchId,
      tableId,
      reservationDate: new Date('2026-08-01T00:00:00.000Z'),
      reservationStartTime: startTime,
      reservationEndTime: new Date('2026-08-01T19:30:00.000Z'),
      guests: 2,
      tableCapacity: 4,
      notes: null,
      createdBy: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      now: fixedNow,
    });
    return Reservation.reconstitute({
      ...created.toProps(),
      status: overrides?.status ?? ReservationStatus.Approved,
    });
  }

  async function build(clockAt: Date) {
    const reservationRepository = new InMemoryReservationRepository();
    const reservationHistoryRepository = new InMemoryReservationHistoryRepository();
    const tableRepository = new InMemoryTableRepository();

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
        status: TableStatus.Reserved,
        mergeGroupId: null,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );

    const eventPublisher = new CollectingEventPublisher();
    const useCase = new CompleteReservationUseCase(
      reservationRepository,
      reservationHistoryRepository,
      tableRepository,
      new FixedClock(clockAt),
      new SequentialIdGenerator([
        'aaaaaaaa-0003-4000-8000-000000000001',
        'aaaaaaaa-0003-4000-8000-000000000002',
      ]),
      eventPublisher,
      new ImmediateUnitOfWork(),
    );

    return {
      useCase,
      reservationRepository,
      reservationHistoryRepository,
      tableRepository,
      eventPublisher,
    };
  }

  it('completes an Approved reservation once the service window has begun, releasing the Table', async () => {
    const { useCase, reservationRepository, tableRepository } = await build(startTime);
    await reservationRepository.seed(approvedReservation());

    const result = await useCase.execute({ actor: employeeActor(), reservationId });

    expect(result.status).toBe('Completed');
    const table = await tableRepository.findById(TableId.create(tableId));
    expect(table?.status).toBe(TableStatus.Available);
  });

  it('rejects completing before the scheduled service window has begun', async () => {
    const { useCase, reservationRepository } = await build(new Date('2026-08-01T10:00:00.000Z'));
    await reservationRepository.seed(approvedReservation());

    await expect(useCase.execute({ actor: employeeActor(), reservationId })).rejects.toBeInstanceOf(
      InvalidReservationTimeException,
    );
  });

  it('publishes ReservationCompleted with the acting employeeId', async () => {
    const { useCase, reservationRepository, eventPublisher } = await build(startTime);
    await reservationRepository.seed(approvedReservation());

    await useCase.execute({ actor: employeeActor(), reservationId });

    const event = eventPublisher.events[0] as ReservationCompletedEvent;
    expect(event).toBeInstanceOf(ReservationCompletedEvent);
    expect(event.payload).toMatchObject({ reservationId, completedBy: 'employee-1' });
  });

  it('rejects an Employee outside branch scope', async () => {
    const { useCase, reservationRepository } = await build(startTime);
    await reservationRepository.seed(approvedReservation());

    await expect(
      useCase.execute({ actor: employeeActor({ branchIds: [otherBranchId] }), reservationId }),
    ).rejects.toBeInstanceOf(EmployeeBranchNotAssignedException);
  });

  it('throws ReservationNotFoundException for an unknown reservation', async () => {
    const { useCase } = await build(startTime);

    await expect(
      useCase.execute({
        actor: employeeActor(),
        reservationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      }),
    ).rejects.toBeInstanceOf(ReservationNotFoundException);
  });

  it.each([
    ReservationStatus.Pending,
    ReservationStatus.Rejected,
    ReservationStatus.Cancelled,
    ReservationStatus.Completed,
    ReservationStatus.Expired,
    ReservationStatus.NoShow,
  ])('rejects completing a reservation that is %s (not Approved)', async (status) => {
    const { useCase, reservationRepository } = await build(startTime);
    await reservationRepository.seed(approvedReservation({ status }));

    await expect(useCase.execute({ actor: employeeActor(), reservationId })).rejects.toBeInstanceOf(
      InvalidReservationStatusTransitionException,
    );
  });
});
