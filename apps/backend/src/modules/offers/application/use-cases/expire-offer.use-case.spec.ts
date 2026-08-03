import { ExpireOfferUseCase } from './expire-offer.use-case';
import { OfferStatus } from '../../domain/enums/offer.enums';
import { OfferExpiredEvent } from '../../domain/events/offer.events';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryOfferRepository } from '../../../../../test/offers/support/in-memory-offer.repository';
import { testOffer } from '../../../../../test/offers/support/offer-test-fixtures';

describe('ExpireOfferUseCase', () => {
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const offerId = '22222222-2222-4222-8222-222222222222';
  const organizationId = 'org-1';
  const publishAt = new Date('2026-08-01T10:00:00.000Z');
  const expireAt = new Date('2026-09-01T00:00:00.000Z');

  async function build() {
    const offerRepository = new InMemoryOfferRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new ExpireOfferUseCase(
      offerRepository,
      new FixedClock(expireAt),
      new SequentialIdGenerator(['aaaaaaaa-0006-4000-8000-000000000001']),
      eventPublisher,
      new ImmediateUnitOfWork(),
      new TenantContextService(),
    );
    return { useCase, offerRepository, eventPublisher };
  }

  it('expires a Published offer and publishes OfferExpired (System-attributed)', async () => {
    const { useCase, offerRepository, eventPublisher } = await build();
    const published = testOffer({ id: offerId, restaurantId }).publish(publishAt);
    await offerRepository.seed(published);

    await useCase.execute({ offerId, organizationId });

    const stored = await offerRepository.findById(published.offerId);
    expect(stored?.status).toBe(OfferStatus.Expired);
    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(OfferExpiredEvent);
  });

  it('is a safe no-op for an unknown offer id', async () => {
    const { useCase, eventPublisher } = await build();
    await useCase.execute({ offerId, organizationId });
    expect(eventPublisher.events).toHaveLength(0);
  });

  it('is a safe no-op (idempotent replay) when the offer is already Expired', async () => {
    const { useCase, offerRepository, eventPublisher } = await build();
    const expired = testOffer({ id: offerId, restaurantId }).publish(publishAt).expire(expireAt);
    await offerRepository.seed(expired);

    await useCase.execute({ offerId, organizationId });

    expect(eventPublisher.events).toHaveLength(0);
  });

  it('is a safe no-op for a still-Draft offer (never reachable in practice, but must not throw)', async () => {
    const { useCase, offerRepository, eventPublisher } = await build();
    await offerRepository.seed(testOffer({ id: offerId, restaurantId }));

    await useCase.execute({ offerId, organizationId });

    expect(eventPublisher.events).toHaveLength(0);
  });

  it('is a safe no-op for a soft-deleted offer (deleted after publish, before the job fired)', async () => {
    const { useCase, offerRepository, eventPublisher } = await build();
    const published = testOffer({ id: offerId, restaurantId }).publish(publishAt);
    // Simulate deletion racing ahead of the scheduled expiration job: seed
    // directly bypassing findById's own deletedAt filter isn't possible via
    // the public API, so seed the deleted state and confirm findById already
    // treats it as gone (mirrors the real CAS `deleted_at IS NULL` guard).
    await offerRepository.seed(published.softDelete(new Date('2026-08-20T00:00:00.000Z')));

    await useCase.execute({ offerId, organizationId });

    expect(eventPublisher.events).toHaveLength(0);
  });
});
