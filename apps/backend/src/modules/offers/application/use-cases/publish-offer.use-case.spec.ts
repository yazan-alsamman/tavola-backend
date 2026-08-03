import { PublishOfferUseCase } from './publish-offer.use-case';
import { OfferNotFoundException } from '../../domain/exceptions/offer-not-found.exception';
import { InvalidOfferStatusTransitionException } from '../../domain/exceptions/invalid-offer-status-transition.exception';
import { InvalidOfferException } from '../../domain/exceptions/invalid-offer.exception';
import { OfferStatus } from '../../domain/enums/offer.enums';
import { OfferPublishedEvent } from '../../domain/events/offer.events';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryOfferRepository } from '../../../../../test/offers/support/in-memory-offer.repository';
import { InMemoryOfferExpirationScheduler } from '../../../../../test/offers/support/in-memory-offer-expiration-scheduler';
import {
  orgMemberActor,
  testOffer,
  testOfferContent,
  testRestaurant,
} from '../../../../../test/offers/support/offer-test-fixtures';

describe('PublishOfferUseCase', () => {
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const organizationId = '11111111-1111-4111-8111-111111111199';
  const offerId = '22222222-2222-4222-8222-222222222222';
  const fixedNow = new Date('2026-08-02T00:00:00.000Z');

  async function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const offerRepository = new InMemoryOfferRepository();
    const eventPublisher = new CollectingEventPublisher();
    const expirationScheduler = new InMemoryOfferExpirationScheduler();
    await restaurantRepository.save(testRestaurant({ id: restaurantId, organizationId }));
    const useCase = new PublishOfferUseCase(
      restaurantRepository,
      offerRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator(['aaaaaaaa-0003-4000-8000-000000000001']),
      eventPublisher,
      new ImmediateUnitOfWork(),
      expirationScheduler,
    );
    return { useCase, offerRepository, eventPublisher, expirationScheduler };
  }

  it('publishes a Draft offer, schedules expiration, and publishes OfferPublished', async () => {
    const { useCase, offerRepository, eventPublisher, expirationScheduler } = await build();
    const offer = testOffer({ id: offerId, restaurantId, content: testOfferContent() });
    await offerRepository.seed(offer);

    const result = await useCase.execute({ actor: orgMemberActor(), restaurantId, offerId });

    expect(result.status).toBe(OfferStatus.Published);
    expect(expirationScheduler.scheduled.has(offerId)).toBe(true);
    expect(expirationScheduler.scheduled.get(offerId)?.organizationId).toBe(organizationId);
    expect(expirationScheduler.scheduled.get(offerId)?.expireAt).toEqual(offer.endsAt);
    expect(eventPublisher.events.some((e) => e instanceof OfferPublishedEvent)).toBe(true);
  });

  it('404s for an unknown offer id', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({ actor: orgMemberActor(), restaurantId, offerId }),
    ).rejects.toBeInstanceOf(OfferNotFoundException);
  });

  it('rejects publishing a non-Draft offer (400)', async () => {
    const { useCase, offerRepository } = await build();
    const published = testOffer({ id: offerId, restaurantId }).publish(fixedNow);
    await offerRepository.seed(published);

    await expect(
      useCase.execute({ actor: orgMemberActor(), restaurantId, offerId }),
    ).rejects.toBeInstanceOf(InvalidOfferStatusTransitionException);
  });

  it('rejects publishing when endsAt has already passed (400)', async () => {
    const { useCase, offerRepository } = await build();
    const offer = testOffer({
      id: offerId,
      restaurantId,
      content: testOfferContent({
        startsAt: new Date('2026-07-01T00:00:00.000Z'),
        endsAt: new Date('2026-07-31T00:00:00.000Z'),
      }),
    });
    await offerRepository.seed(offer);

    await expect(
      useCase.execute({ actor: orgMemberActor(), restaurantId, offerId }),
    ).rejects.toBeInstanceOf(InvalidOfferException);
  });
});
