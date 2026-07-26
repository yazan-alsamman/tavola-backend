import { MarkTableReadyReservationUseCase } from './mark-table-ready-reservation.use-case';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationSource, ReservationStatus } from '../../domain/enums/reservation.enums';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';
import { InvalidReservationStatusTransitionException } from '../../domain/exceptions/invalid-reservation-status-transition.exception';
import { TableReadyNotifiedEvent } from '../../domain/events/reservation.events';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingEventPublisher,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';

describe('MarkTableReadyReservationUseCase', () => {
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
      permissions: ['reservations:tableready'],
      permissionsVersion: 1,
    };
  }

  function approvedReservation(overrides?: {
    status?: ReservationStatus;
    tableReadyNotifiedAt?: Date | null;
  }) {
    const created = Reservation.create({
      id: reservationId,
      userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      reservationGuestId: null,
      source: ReservationSource.Online,
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
      tableReadyNotifiedAt: overrides?.tableReadyNotifiedAt ?? null,
    });
  }

  function build(clockAt: Date) {
    const reservationRepository = new InMemoryReservationRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new MarkTableReadyReservationUseCase(
      reservationRepository,
      new FixedClock(clockAt),
      new SequentialIdGenerator(['aaaaaaaa-0007-4000-8000-000000000001']),
      eventPublisher,
    );

    return { useCase, reservationRepository, eventPublisher };
  }

  it('marks an Approved reservation table-ready without changing status or touching the Table', async () => {
    const { useCase, reservationRepository } = build(startTime);
    reservationRepository.seed(approvedReservation());

    const result = await useCase.execute({ actor: employeeActor(), reservationId });

    expect(result.status).toBe('Approved');
  });

  it('publishes TableReadyNotified with the acting employeeId', async () => {
    const { useCase, reservationRepository, eventPublisher } = build(startTime);
    reservationRepository.seed(approvedReservation());

    await useCase.execute({ actor: employeeActor(), reservationId });

    const event = eventPublisher.events[0] as TableReadyNotifiedEvent;
    expect(event).toBeInstanceOf(TableReadyNotifiedEvent);
    expect(event.payload).toMatchObject({ reservationId, markedBy: 'employee-1' });
  });

  it('rejects an Employee outside branch scope', async () => {
    const { useCase, reservationRepository } = build(startTime);
    reservationRepository.seed(approvedReservation());

    await expect(
      useCase.execute({ actor: employeeActor({ branchIds: [otherBranchId] }), reservationId }),
    ).rejects.toBeInstanceOf(EmployeeBranchNotAssignedException);
  });

  it('throws ReservationNotFoundException for an unknown reservation', async () => {
    const { useCase } = build(startTime);

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
  ])('rejects marking table-ready on a reservation that is %s (not Approved)', async (status) => {
    const { useCase, reservationRepository } = build(startTime);
    reservationRepository.seed(approvedReservation({ status }));

    await expect(useCase.execute({ actor: employeeActor(), reservationId })).rejects.toBeInstanceOf(
      InvalidReservationStatusTransitionException,
    );
  });

  it('rejects marking table-ready twice', async () => {
    const { useCase, reservationRepository } = build(startTime);
    reservationRepository.seed(
      approvedReservation({ tableReadyNotifiedAt: new Date('2026-08-01T17:50:00.000Z') }),
    );

    await expect(useCase.execute({ actor: employeeActor(), reservationId })).rejects.toBeInstanceOf(
      InvalidReservationStatusTransitionException,
    );
  });
});
