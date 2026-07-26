import { CancelWaitlistEntryUseCase } from './cancel-waitlist-entry.use-case';
import { ReservationWaitlistEntry } from '../../domain/entities/reservation-waitlist-entry.entity';
import { WaitlistStatus } from '../../domain/enums/waitlist.enums';
import { WaitlistEntryNotFoundException } from '../../domain/exceptions/waitlist-entry-not-found.exception';
import { InvalidWaitlistStatusTransitionException } from '../../domain/exceptions/invalid-waitlist-status-transition.exception';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { WaitlistEntryCancelledEvent } from '../../domain/events/waitlist.events';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryReservationWaitlistEntryRepository } from '../../../../../test/waitlist/support/in-memory-reservation-waitlist-entry.repository';
import { InMemoryWaitlistExpirationScheduler } from '../../../../../test/waitlist/support/in-memory-waitlist-expiration-scheduler';

describe('CancelWaitlistEntryUseCase', () => {
  const now = new Date('2026-08-01T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const customerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const entryId = '11111111-1111-4111-8111-111111111111';

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

  function entry(overrides: Partial<Parameters<typeof ReservationWaitlistEntry.create>[0]> = {}) {
    return ReservationWaitlistEntry.create({
      id: entryId,
      restaurantId,
      branchId,
      userId: customerId,
      reservationGuestId: null,
      partySize: 2,
      preferredDate: new Date('2026-08-01T00:00:00.000Z'),
      preferredTimeFrom: new Date(Date.UTC(1970, 0, 1, 19, 0, 0)),
      preferredTimeTo: null,
      position: 1,
      expiresAt: new Date('2026-08-01T23:59:59.999Z'),
      notes: null,
      createdBy: customerId,
      now,
      ...overrides,
    });
  }

  async function build() {
    const waitlistRepository = new InMemoryReservationWaitlistEntryRepository();
    const eventPublisher = new CollectingEventPublisher();
    const expirationScheduler = new InMemoryWaitlistExpirationScheduler();

    const useCase = new CancelWaitlistEntryUseCase(
      waitlistRepository,
      new FixedClock(now),
      new SequentialIdGenerator(['aaaaaaaa-0007-4000-8000-000000000001']),
      eventPublisher,
      new ImmediateUnitOfWork(),
      expirationScheduler,
    );

    return { useCase, waitlistRepository, eventPublisher, expirationScheduler };
  }

  it('lets the owning Customer cancel their own Waiting entry', async () => {
    const { useCase, waitlistRepository, eventPublisher, expirationScheduler } = await build();
    await waitlistRepository.seed(entry());

    const result = await useCase.execute({ actor: userActor(), entryId });

    expect(result.status).toBe(WaitlistStatus.Cancelled);
    expect(expirationScheduler.cancelledEntryIds).toContain(entryId);
    const event = eventPublisher.events.find((e) => e instanceof WaitlistEntryCancelledEvent) as
      WaitlistEntryCancelledEvent | undefined;
    expect(event?.payload.cancelledBy).toBe(customerId);
    expect(event?.payload.cancelledByActorType).toBe('User');
  });

  it('rejects a different Customer cancelling someone elses entry (collapses to 404)', async () => {
    const { useCase, waitlistRepository } = await build();
    await waitlistRepository.seed(entry());

    await expect(
      useCase.execute({ actor: userActor('dddddddd-dddd-4ddd-8ddd-dddddddddddd'), entryId }),
    ).rejects.toThrow(WaitlistEntryNotFoundException);
  });

  it('lets a branch-scoped Employee holding reservations:waitlist cancel', async () => {
    const { useCase, waitlistRepository, eventPublisher } = await build();
    await waitlistRepository.seed(entry());

    const result = await useCase.execute({ actor: employeeActor(), entryId });
    expect(result.status).toBe(WaitlistStatus.Cancelled);
    const event = eventPublisher.events.find((e) => e instanceof WaitlistEntryCancelledEvent) as
      WaitlistEntryCancelledEvent | undefined;
    expect(event?.payload.cancelledBy).toBe('employee-1');
    expect(event?.payload.cancelledByActorType).toBe('Employee');
  });

  it('rejects an Employee outside branch scope', async () => {
    const { useCase, waitlistRepository } = await build();
    await waitlistRepository.seed(entry());

    await expect(
      useCase.execute({ actor: employeeActor({ branchIds: ['other-branch'] }), entryId }),
    ).rejects.toThrow(EmployeeBranchNotAssignedException);
  });

  it('rejects an Employee lacking reservations:waitlist', async () => {
    const { useCase, waitlistRepository } = await build();
    await waitlistRepository.seed(entry());

    await expect(
      useCase.execute({ actor: employeeActor({ permissions: [] }), entryId }),
    ).rejects.toThrow(PermissionDeniedException);
  });

  it('rejects cancelling an already-Converted entry', async () => {
    const { useCase, waitlistRepository } = await build();
    await waitlistRepository.seed(entry({}).convert('reservation-1', now));

    await expect(useCase.execute({ actor: userActor(), entryId })).rejects.toThrow(
      InvalidWaitlistStatusTransitionException,
    );
  });

  it('throws 404 for an unknown entry id', async () => {
    const { useCase } = await build();
    await expect(useCase.execute({ actor: userActor(), entryId: 'unknown-id' })).rejects.toThrow(
      WaitlistEntryNotFoundException,
    );
  });
});
