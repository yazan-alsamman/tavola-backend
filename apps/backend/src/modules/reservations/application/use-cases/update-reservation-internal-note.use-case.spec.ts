import { UpdateReservationInternalNoteUseCase } from './update-reservation-internal-note.use-case';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationSource, ReservationStatus } from '../../domain/enums/reservation.enums';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { ReservationId } from '@shared/domain/value-objects/identifiers.vo';
import { FixedClock } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';

describe('UpdateReservationInternalNoteUseCase', () => {
  const now = new Date('2026-08-01T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const reservationId = '66666666-6666-4666-8666-666666666666';

  function employee(overrides?: { branchIds?: string[]; permissions?: string[] }) {
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
      permissions: overrides?.permissions ?? ['reservations:create'],
      permissionsVersion: 1,
    };
  }

  function build() {
    const repository = new InMemoryReservationRepository();
    const reservation = Reservation.create({
      id: reservationId,
      userId: null,
      reservationGuestId: '77777777-7777-4777-8777-777777777777',
      source: ReservationSource.Phone,
      restaurantId,
      branchId,
      tableId: '55555555-5555-4555-8555-555555555555',
      reservationDate: new Date('2026-08-01T00:00:00.000Z'),
      reservationStartTime: new Date('2026-08-01T18:00:00.000Z'),
      reservationEndTime: new Date('2026-08-01T19:30:00.000Z'),
      guests: 2,
      tableCapacity: 4,
      notes: null,
      createdBy: 'employee-1',
      now,
    });
    repository.seed(reservation);
    const useCase = new UpdateReservationInternalNoteUseCase(
      repository,
      new InMemoryRestaurantRepository(),
      new FixedClock(now),
    );
    return { repository, useCase };
  }

  it('saves a trimmed note without touching the status', async () => {
    const { repository, useCase } = build();
    const result = await useCase.execute({
      actor: employee(),
      reservationId,
      internalNote: '  Nut allergy - window seat  ',
    });
    expect(result).toEqual({ reservationId, internalNote: 'Nut allergy - window seat' });
    const stored = await repository.findById(ReservationId.create(reservationId));
    expect(stored?.internalNote).toBe('Nut allergy - window seat');
    expect(stored?.status).toBe(ReservationStatus.Pending);
  });

  it('clears the note when it is blank', async () => {
    const { repository, useCase } = build();
    await useCase.execute({ actor: employee(), reservationId, internalNote: 'x' });
    const result = await useCase.execute({ actor: employee(), reservationId, internalNote: '   ' });
    expect(result.internalNote).toBeNull();
    const stored = await repository.findById(ReservationId.create(reservationId));
    expect(stored?.internalNote).toBeNull();
  });

  it('rejects an employee without reservations:create', async () => {
    const { useCase } = build();
    await expect(
      useCase.execute({
        actor: employee({ permissions: [] }),
        reservationId,
        internalNote: 'x',
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedException);
  });

  it('rejects an employee scoped to another branch', async () => {
    const { useCase } = build();
    await expect(
      useCase.execute({
        actor: employee({ branchIds: ['99999999-9999-4999-8999-999999999991'] }),
        reservationId,
        internalNote: 'x',
      }),
    ).rejects.toBeInstanceOf(EmployeeBranchNotAssignedException);
  });

  it('returns not found for an unknown reservation', async () => {
    const { useCase } = build();
    await expect(
      useCase.execute({
        actor: employee(),
        reservationId: '12121212-1212-4212-8212-121212121212',
        internalNote: 'x',
      }),
    ).rejects.toBeInstanceOf(ReservationNotFoundException);
  });
});
