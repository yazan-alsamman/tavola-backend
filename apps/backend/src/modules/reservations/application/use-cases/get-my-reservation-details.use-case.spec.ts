import { GetMyReservationDetailsUseCase } from './get-my-reservation-details.use-case';
import { GetMyReservationUseCase } from './get-my-reservation.use-case';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationSource } from '../../domain/enums/reservation.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';

describe('GetMyReservationDetailsUseCase', () => {
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const tableId = '55555555-5555-4555-8555-555555555555';
  const userId = '22222222-2222-4222-8222-222222222222';
  const otherUserId = '22222222-2222-4222-8222-222222222299';
  const reservationId = '11111111-1111-4111-8111-111111111111';
  const fixedNow = new Date('2026-08-01T10:00:00.000Z');

  function customerActor(id: string) {
    return {
      actorType: AccessTokenActorType.User as const,
      userId: id,
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
    };
  }

  function employeeActor(id: string) {
    return {
      actorType: AccessTokenActorType.Employee as const,
      userId: id,
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      employeeId: 'employee-1',
      organizationId: 'org-1',
      restaurantId,
      branchIds: [branchId],
      permissions: [],
      permissionsVersion: 1,
    };
  }

  function organizationMemberActor(id: string) {
    return {
      actorType: AccessTokenActorType.OrganizationMember as const,
      userId: id,
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      organizationId: 'org-1',
      orgRole: 'Owner',
      permissionsVersion: 1,
    };
  }

  function makeReservation(id: string, ownerUserId: string | null, guestId: string | null) {
    return Reservation.create({
      id,
      userId: ownerUserId,
      reservationGuestId: guestId,
      source: ownerUserId ? ReservationSource.Online : ReservationSource.WalkIn,
      restaurantId,
      branchId,
      tableId,
      reservationDate: new Date('2026-08-10T00:00:00.000Z'),
      reservationStartTime: new Date('2026-08-10T18:00:00.000Z'),
      reservationEndTime: new Date('2026-08-10T19:30:00.000Z'),
      guests: 2,
      tableCapacity: 4,
      notes: null,
      createdBy: ownerUserId ?? 'employee-1',
      now: fixedNow,
    });
  }

  function makeUseCase(reservationRepository: InMemoryReservationRepository) {
    return new GetMyReservationDetailsUseCase(new GetMyReservationUseCase(reservationRepository));
  }

  it("returns the caller's own reservation with the full flat reservation shape", async () => {
    const reservationRepository = new InMemoryReservationRepository();
    reservationRepository.seed(makeReservation(reservationId, userId, null));

    const useCase = makeUseCase(reservationRepository);
    const result = await useCase.execute({ actor: customerActor(userId), reservationId });

    expect(result.reservationId).toBe(reservationId);
    expect(result.restaurantId).toBe(restaurantId);
    expect(result.branchId).toBe(branchId);
    expect(result.tableId).toBe(tableId);
  });

  it("404s (IDOR-safe) for another Customer's reservation", async () => {
    const reservationRepository = new InMemoryReservationRepository();
    reservationRepository.seed(makeReservation(reservationId, otherUserId, null));

    const useCase = makeUseCase(reservationRepository);
    await expect(
      useCase.execute({ actor: customerActor(userId), reservationId }),
    ).rejects.toBeInstanceOf(ReservationNotFoundException);
  });

  it('404s (IDOR-safe) for a guest (Phone/WalkIn) reservation with no owning User', async () => {
    const reservationRepository = new InMemoryReservationRepository();
    reservationRepository.seed(makeReservation(reservationId, null, 'guest-1'));

    const useCase = makeUseCase(reservationRepository);
    await expect(
      useCase.execute({ actor: customerActor(userId), reservationId }),
    ).rejects.toBeInstanceOf(ReservationNotFoundException);
  });

  it('404s for an unknown reservation id', async () => {
    const reservationRepository = new InMemoryReservationRepository();
    const useCase = makeUseCase(reservationRepository);
    await expect(
      useCase.execute({ actor: customerActor(userId), reservationId }),
    ).rejects.toBeInstanceOf(ReservationNotFoundException);
  });

  it('rejects an Employee actor even when it owns the reservation (Customer-only endpoint family)', async () => {
    const reservationRepository = new InMemoryReservationRepository();
    reservationRepository.seed(makeReservation(reservationId, userId, null));

    const useCase = makeUseCase(reservationRepository);
    await expect(
      useCase.execute({ actor: employeeActor(userId), reservationId }),
    ).rejects.toBeInstanceOf(PermissionDeniedException);
  });

  it('rejects an OrganizationMember actor', async () => {
    const reservationRepository = new InMemoryReservationRepository();
    reservationRepository.seed(makeReservation(reservationId, userId, null));

    const useCase = makeUseCase(reservationRepository);
    await expect(
      useCase.execute({ actor: organizationMemberActor(userId), reservationId }),
    ).rejects.toBeInstanceOf(PermissionDeniedException);
  });
});
