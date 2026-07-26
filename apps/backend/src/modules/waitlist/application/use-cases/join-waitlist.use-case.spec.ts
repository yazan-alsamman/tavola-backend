import { JoinWaitlistUseCase } from './join-waitlist.use-case';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { WaitlistPreferredTimeInPastException } from '../../domain/exceptions/waitlist-preferred-time-in-past.exception';
import { InvalidWaitlistEntryException } from '../../domain/exceptions/invalid-waitlist-entry.exception';
import { WaitlistEntryCreatedEvent } from '../../domain/events/waitlist.events';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryReservationGuestRepository } from '../../../../../test/reservations/support/in-memory-reservation-guest.repository';
import { InMemoryReservationWaitlistEntryRepository } from '../../../../../test/waitlist/support/in-memory-reservation-waitlist-entry.repository';
import { InMemoryWaitlistExpirationScheduler } from '../../../../../test/waitlist/support/in-memory-waitlist-expiration-scheduler';

describe('JoinWaitlistUseCase', () => {
  const now = new Date('2026-08-01T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  function userActor(userId: string = customerId) {
    return {
      actorType: AccessTokenActorType.User as const,
      userId,
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
    };
  }

  function employeeActor(overrides?: { branchIds?: string[]; permissions?: string[] }) {
    return {
      actorType: AccessTokenActorType.Employee as const,
      userId: 'employee-user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      employeeId: 'employee-1',
      organizationId: 'org-1',
      restaurantId,
      branchIds: overrides?.branchIds ?? [],
      permissions: overrides?.permissions ?? ['reservations:waitlist'],
      permissionsVersion: 1,
    };
  }

  async function build() {
    const branchRepository = new InMemoryBranchRepository();
    const reservationGuestRepository = new InMemoryReservationGuestRepository();
    const waitlistRepository = new InMemoryReservationWaitlistEntryRepository();
    const eventPublisher = new CollectingEventPublisher();
    const expirationScheduler = new InMemoryWaitlistExpirationScheduler();

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
        timezone: 'UTC',
        phone: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );

    const useCase = new JoinWaitlistUseCase(
      branchRepository,
      reservationGuestRepository,
      waitlistRepository,
      new FixedClock(now),
      new SequentialIdGenerator(
        Array.from(
          { length: 20 },
          (_, i) => `aaaaaaaa-0006-4000-8000-${(i + 1).toString().padStart(12, '0')}`,
        ),
      ),
      eventPublisher,
      new ImmediateUnitOfWork(),
      expirationScheduler,
    );

    return { useCase, branchRepository, waitlistRepository, eventPublisher, expirationScheduler };
  }

  it('joins a Customer for themselves', async () => {
    const { useCase, eventPublisher, expirationScheduler } = await build();
    const result = await useCase.execute({
      actor: userActor(),
      branchId,
      partySize: 4,
      preferredDate: '2026-08-01',
      preferredTimeFrom: '19:00',
      correlationId: 'corr-1',
    });

    expect(result.userId).toBe(customerId);
    expect(result.reservationGuestId).toBeNull();
    expect(result.position).toBe(1);
    expect(result.status).toBe('Waiting');

    expect(expirationScheduler.scheduled.has(result.entryId)).toBe(true);
    const created = eventPublisher.events.find((e) => e instanceof WaitlistEntryCreatedEvent);
    expect(created).toBeDefined();
  });

  it('assigns FIFO positions within the same (branchId, preferredDate) queue scope', async () => {
    const { useCase } = await build();
    const first = await useCase.execute({
      actor: userActor('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      branchId,
      partySize: 2,
      preferredDate: '2026-08-01',
      preferredTimeFrom: '19:00',
    });
    const second = await useCase.execute({
      actor: userActor('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
      branchId,
      partySize: 2,
      preferredDate: '2026-08-01',
      preferredTimeFrom: '20:00',
    });

    expect(first.position).toBe(1);
    expect(second.position).toBe(2);
  });

  it('lets an Employee holding reservations:waitlist join on behalf of a guest', async () => {
    const { useCase, waitlistRepository } = await build();
    const result = await useCase.execute({
      actor: employeeActor(),
      branchId,
      partySize: 3,
      preferredDate: '2026-08-01',
      preferredTimeFrom: '19:00',
      reservationGuest: {
        fullName: 'Jane Doe',
        countryCode: 'SY',
        phoneNumber: '0912345678',
      },
    });

    expect(result.userId).toBeNull();
    expect(result.reservationGuestId).not.toBeNull();
    const stored = await waitlistRepository.findById(result.entryId);
    expect(stored?.createdBy).toBe('employee-1');
  });

  it('rejects an Employee outside branch scope from joining on behalf of a guest', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: employeeActor({ branchIds: ['some-other-branch'] }),
        branchId,
        partySize: 2,
        preferredDate: '2026-08-01',
        preferredTimeFrom: '19:00',
        reservationGuest: { fullName: 'Jane Doe', countryCode: 'SY', phoneNumber: '0912345678' },
      }),
    ).rejects.toThrow(EmployeeBranchNotAssignedException);
  });

  it('rejects an Employee lacking reservations:waitlist from joining on behalf of a guest', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: employeeActor({ permissions: [] }),
        branchId,
        partySize: 2,
        preferredDate: '2026-08-01',
        preferredTimeFrom: '19:00',
        reservationGuest: { fullName: 'Jane Doe', countryCode: 'SY', phoneNumber: '0912345678' },
      }),
    ).rejects.toThrow(PermissionDeniedException);
  });

  it('rejects reservationGuest supplied by a non-Employee actor', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: userActor(),
        branchId,
        partySize: 2,
        preferredDate: '2026-08-01',
        preferredTimeFrom: '19:00',
        reservationGuest: { fullName: 'Jane Doe', countryCode: 'SY', phoneNumber: '0912345678' },
      }),
    ).rejects.toThrow(PermissionDeniedException);
  });

  it('rejects a derived start time already in the past', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: userActor(),
        branchId,
        partySize: 2,
        preferredDate: '2026-08-01',
        preferredTimeFrom: '09:00', // now is 2026-08-01T10:00:00Z
      }),
    ).rejects.toThrow(WaitlistPreferredTimeInPastException);
  });

  it('rejects a branch that does not exist', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: userActor(),
        branchId: '99999999-9999-4999-8999-999999999999',
        partySize: 2,
        preferredDate: '2026-08-01',
        preferredTimeFrom: '19:00',
      }),
    ).rejects.toThrow(BranchNotFoundException);
  });

  it('rejects a malformed preferredTimeFrom', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: userActor(),
        branchId,
        partySize: 2,
        preferredDate: '2026-08-01',
        preferredTimeFrom: '25:99',
      }),
    ).rejects.toThrow(InvalidWaitlistEntryException);
  });
});
