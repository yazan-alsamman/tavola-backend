import { RejectReservationUseCase } from './reject-reservation.use-case';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationSource, ReservationStatus } from '../../domain/enums/reservation.enums';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';
import { InvalidReservationStatusTransitionException } from '../../domain/exceptions/invalid-reservation-status-transition.exception';
import { ReservationRejectedEvent } from '../../domain/events/reservation.events';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingEventPublisher,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';
import { InMemoryReservationExpirationScheduler } from '../../../../../test/reservations/support/in-memory-reservation-expiration-scheduler';

describe('RejectReservationUseCase', () => {
  const fixedNow = new Date('2026-08-01T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const otherBranchId = '99999999-9999-4999-8999-999999999991';
  const tableId = '55555555-5555-4555-8555-555555555555';
  const reservationId = '66666666-6666-4666-8666-666666666666';

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
    restaurantId?: string;
    branchId?: string;
    notes?: string | null;
  }) {
    const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    return Reservation.create({
      id: reservationId,
      userId: customerId,
      reservationGuestId: null,
      source: ReservationSource.Online,
      restaurantId: overrides?.restaurantId ?? restaurantId,
      branchId: overrides?.branchId ?? branchId,
      tableId,
      reservationDate: new Date('2026-08-01T00:00:00.000Z'),
      reservationStartTime: new Date('2026-08-01T18:00:00.000Z'),
      reservationEndTime: new Date('2026-08-01T19:30:00.000Z'),
      guests: 2,
      tableCapacity: 4,
      notes: overrides?.notes ?? null,
      createdBy: customerId,
      now: fixedNow,
    });
  }

  function build() {
    const reservationRepository = new InMemoryReservationRepository();
    const eventPublisher = new CollectingEventPublisher();
    const expirationScheduler = new InMemoryReservationExpirationScheduler();
    const useCase = new RejectReservationUseCase(
      reservationRepository,
      new FixedClock(new Date('2026-08-01T11:00:00.000Z')),
      new SequentialIdGenerator([
        'bbbbbbbb-0001-4000-8000-000000000001',
        'bbbbbbbb-0001-4000-8000-000000000002',
      ]),
      eventPublisher,
      expirationScheduler,
    );
    return { useCase, reservationRepository, eventPublisher, expirationScheduler };
  }

  it('rejects a Pending reservation without touching notes', async () => {
    const { useCase, reservationRepository } = build();
    reservationRepository.seed(pendingReservation({ notes: 'Anniversary dinner' }));

    const result = await useCase.execute({ actor: employeeActor(), reservationId });
    expect(result.status).toBe('Rejected');
    expect(result.notes).toBe('Anniversary dinner');
  });

  it('publishes ReservationRejected with automatic: false and the rejecting employeeId', async () => {
    const { useCase, reservationRepository, eventPublisher } = build();
    reservationRepository.seed(pendingReservation());

    await useCase.execute({ actor: employeeActor(), reservationId });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as ReservationRejectedEvent;
    expect(event).toBeInstanceOf(ReservationRejectedEvent);
    expect(event.payload).toMatchObject({
      reservationId,
      rejectedBy: 'employee-1',
      automatic: false,
    });
  });

  it('throws ReservationNotFoundException for an unknown reservation', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute({
        actor: employeeActor(),
        reservationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      }),
    ).rejects.toBeInstanceOf(ReservationNotFoundException);
  });

  it('throws ReservationNotFoundException (IDOR) for a reservation belonging to a different restaurant', async () => {
    const { useCase, reservationRepository } = build();
    reservationRepository.seed(
      pendingReservation({ restaurantId: '11111111-1111-4111-8111-111111111199' }),
    );

    await expect(useCase.execute({ actor: employeeActor(), reservationId })).rejects.toBeInstanceOf(
      ReservationNotFoundException,
    );
  });

  it('throws EmployeeBranchNotAssignedException when the Employee is scoped to a different branch', async () => {
    const { useCase, reservationRepository } = build();
    reservationRepository.seed(pendingReservation());

    await expect(
      useCase.execute({
        actor: employeeActor({ branchIds: [otherBranchId] }),
        reservationId,
      }),
    ).rejects.toBeInstanceOf(EmployeeBranchNotAssignedException);
  });

  it.each([
    ReservationStatus.Approved,
    ReservationStatus.Rejected,
    ReservationStatus.Cancelled,
    ReservationStatus.Completed,
    ReservationStatus.Expired,
    ReservationStatus.NoShow,
  ])(
    'throws InvalidReservationStatusTransitionException rejecting a reservation already %s',
    async (status) => {
      const { useCase, reservationRepository } = build();
      reservationRepository.seed(
        Reservation.reconstitute({ ...pendingReservation().toProps(), status }),
      );

      await expect(
        useCase.execute({ actor: employeeActor(), reservationId }),
      ).rejects.toBeInstanceOf(InvalidReservationStatusTransitionException);
    },
  );
});
