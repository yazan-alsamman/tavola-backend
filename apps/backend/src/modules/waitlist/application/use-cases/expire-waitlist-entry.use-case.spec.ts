import { ExpireWaitlistEntryUseCase } from './expire-waitlist-entry.use-case';
import { ReservationWaitlistEntry } from '../../domain/entities/reservation-waitlist-entry.entity';
import { WaitlistStatus } from '../../domain/enums/waitlist.enums';
import { WaitlistEntryExpiredEvent } from '../../domain/events/waitlist.events';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryReservationWaitlistEntryRepository } from '../../../../../test/waitlist/support/in-memory-reservation-waitlist-entry.repository';

describe('ExpireWaitlistEntryUseCase', () => {
  const now = new Date('2026-08-02T00:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const entryId = '11111111-1111-4111-8111-111111111111';

  function entry(status: WaitlistStatus) {
    const created = ReservationWaitlistEntry.create({
      id: entryId,
      restaurantId,
      branchId,
      userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      reservationGuestId: null,
      partySize: 2,
      preferredDate: new Date('2026-08-01T00:00:00.000Z'),
      preferredTimeFrom: new Date(Date.UTC(1970, 0, 1, 19, 0, 0)),
      preferredTimeTo: null,
      position: 1,
      expiresAt: new Date('2026-08-01T23:59:59.999Z'),
      notes: null,
      createdBy: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      now,
    });
    return status === WaitlistStatus.Waiting
      ? created
      : ReservationWaitlistEntry.reconstitute({ ...created.toProps(), status });
  }

  function build() {
    const waitlistRepository = new InMemoryReservationWaitlistEntryRepository();
    const eventPublisher = new CollectingEventPublisher();

    const useCase = new ExpireWaitlistEntryUseCase(
      waitlistRepository,
      new FixedClock(now),
      new SequentialIdGenerator(['aaaaaaaa-0008-4000-8000-000000000001']),
      eventPublisher,
      new ImmediateUnitOfWork(),
      new TenantContextService(),
    );

    return { useCase, waitlistRepository, eventPublisher };
  }

  it('expires a Waiting entry', async () => {
    const { useCase, waitlistRepository, eventPublisher } = build();
    await waitlistRepository.seed(entry(WaitlistStatus.Waiting));

    await useCase.execute({ entryId, organizationId: null });

    const updated = await waitlistRepository.findById(entryId);
    expect(updated?.status).toBe(WaitlistStatus.Expired);
    expect(eventPublisher.events.some((e) => e instanceof WaitlistEntryExpiredEvent)).toBe(true);
  });

  it('expires a Notified entry', async () => {
    const { useCase, waitlistRepository } = build();
    await waitlistRepository.seed(entry(WaitlistStatus.Notified));

    await useCase.execute({ entryId, organizationId: null });

    const updated = await waitlistRepository.findById(entryId);
    expect(updated?.status).toBe(WaitlistStatus.Expired);
  });

  it('is a safe no-op for an already-Converted entry (idempotent, matches a duplicate/replayed job)', async () => {
    const { useCase, waitlistRepository, eventPublisher } = build();
    await waitlistRepository.seed(entry(WaitlistStatus.Converted));

    await useCase.execute({ entryId, organizationId: null });

    const unchanged = await waitlistRepository.findById(entryId);
    expect(unchanged?.status).toBe(WaitlistStatus.Converted);
    expect(eventPublisher.events).toHaveLength(0);
  });

  it('is a safe no-op for an unknown entry id', async () => {
    const { useCase, eventPublisher } = build();
    await expect(
      useCase.execute({ entryId: 'unknown-id', organizationId: null }),
    ).resolves.toBeUndefined();
    expect(eventPublisher.events).toHaveLength(0);
  });
});
