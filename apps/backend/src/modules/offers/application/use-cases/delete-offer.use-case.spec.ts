import { DeleteOfferUseCase } from './delete-offer.use-case';
import { OfferNotFoundException } from '../../domain/exceptions/offer-not-found.exception';
import { OfferId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { OfferDeletedEvent } from '../../domain/events/offer.events';
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
  testRestaurant,
} from '../../../../../test/offers/support/offer-test-fixtures';

describe('DeleteOfferUseCase', () => {
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const offerId = '22222222-2222-4222-8222-222222222222';
  const fixedNow = new Date('2026-08-05T00:00:00.000Z');

  async function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const offerRepository = new InMemoryOfferRepository();
    const eventPublisher = new CollectingEventPublisher();
    const expirationScheduler = new InMemoryOfferExpirationScheduler();
    await restaurantRepository.save(testRestaurant({ id: restaurantId }));
    const useCase = new DeleteOfferUseCase(
      restaurantRepository,
      offerRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator(['aaaaaaaa-0004-4000-8000-000000000001']),
      eventPublisher,
      new ImmediateUnitOfWork(),
      expirationScheduler,
    );
    return { useCase, offerRepository, eventPublisher, expirationScheduler };
  }

  it('soft-deletes a Draft offer', async () => {
    const { useCase, offerRepository, eventPublisher } = await build();
    await offerRepository.seed(testOffer({ id: offerId, restaurantId }));

    await useCase.execute({ actor: orgMemberActor(), restaurantId, offerId });

    const stored = await offerRepository.findByIdAndRestaurantId(
      OfferId.create(offerId),
      RestaurantId.create(restaurantId),
    );
    expect(stored).toBeNull();
    expect(eventPublisher.events[0]).toBeInstanceOf(OfferDeletedEvent);
  });

  it('cancels the expiration job when deleting a Published offer', async () => {
    const { useCase, offerRepository, expirationScheduler } = await build();
    const published = testOffer({ id: offerId, restaurantId }).publish(fixedNow);
    await offerRepository.seed(published);
    expirationScheduler.scheduled.set(offerId, {
      organizationId: 'org-1',
      expireAt: published.endsAt,
    });

    await useCase.execute({ actor: orgMemberActor(), restaurantId, offerId });

    expect(expirationScheduler.cancelledOfferIds).toContain(offerId);
  });

  it('does not attempt to cancel an expiration job for a Draft offer', async () => {
    const { useCase, offerRepository, expirationScheduler } = await build();
    await offerRepository.seed(testOffer({ id: offerId, restaurantId }));

    await useCase.execute({ actor: orgMemberActor(), restaurantId, offerId });

    expect(expirationScheduler.cancelledOfferIds).toHaveLength(0);
  });

  it('404s for an unknown offer id', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({ actor: orgMemberActor(), restaurantId, offerId }),
    ).rejects.toBeInstanceOf(OfferNotFoundException);
  });

  it('404s (not idempotent) on a second delete of the same offer', async () => {
    const { useCase, offerRepository } = await build();
    await offerRepository.seed(testOffer({ id: offerId, restaurantId }));

    await useCase.execute({ actor: orgMemberActor(), restaurantId, offerId });
    await expect(
      useCase.execute({ actor: orgMemberActor(), restaurantId, offerId }),
    ).rejects.toBeInstanceOf(OfferNotFoundException);
  });
});
