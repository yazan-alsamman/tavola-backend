import { UpdateOfferUseCase } from './update-offer.use-case';
import { OfferNotFoundException } from '../../domain/exceptions/offer-not-found.exception';
import { InvalidOfferStatusTransitionException } from '../../domain/exceptions/invalid-offer-status-transition.exception';
import { OfferUpdatedEvent } from '../../domain/events/offer.events';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryOfferRepository } from '../../../../../test/offers/support/in-memory-offer.repository';
import {
  FIXED_NOW,
  orgMemberActor,
  testOffer,
  testOfferContent,
  testRestaurant,
} from '../../../../../test/offers/support/offer-test-fixtures';

describe('UpdateOfferUseCase', () => {
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const offerId = '22222222-2222-4222-8222-222222222222';

  async function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const offerRepository = new InMemoryOfferRepository();
    const eventPublisher = new CollectingEventPublisher();
    await restaurantRepository.save(testRestaurant({ id: restaurantId }));
    const useCase = new UpdateOfferUseCase(
      restaurantRepository,
      offerRepository,
      new FixedClock(new Date('2026-08-02T00:00:00.000Z')),
      new SequentialIdGenerator(['aaaaaaaa-0002-4000-8000-000000000001']),
      eventPublisher,
      new ImmediateUnitOfWork(),
    );
    return { useCase, offerRepository, eventPublisher };
  }

  it('updates content while Draft and publishes OfferUpdated', async () => {
    const { useCase, offerRepository, eventPublisher } = await build();
    await offerRepository.seed(testOffer({ id: offerId, restaurantId }));

    const result = await useCase.execute({
      actor: orgMemberActor(),
      restaurantId,
      offerId,
      ...testOfferContent({ title: 'New Title' }),
    });

    expect(result.title).toBe('New Title');
    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(OfferUpdatedEvent);
  });

  it('404s for an unknown offer id', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: orgMemberActor(),
        restaurantId,
        offerId,
        ...testOfferContent(),
      }),
    ).rejects.toBeInstanceOf(OfferNotFoundException);
  });

  it('rejects updating a Published offer (400)', async () => {
    const { useCase, offerRepository } = await build();
    const offer = testOffer({ id: offerId, restaurantId }).publish(FIXED_NOW);
    await offerRepository.seed(offer);

    await expect(
      useCase.execute({
        actor: orgMemberActor(),
        restaurantId,
        offerId,
        ...testOfferContent(),
      }),
    ).rejects.toBeInstanceOf(InvalidOfferStatusTransitionException);
  });

  it('rejects a concurrent Update after the Offer was published between read and write (CAS race)', async () => {
    const { useCase, offerRepository } = await build();
    const draft = testOffer({ id: offerId, restaurantId });
    await offerRepository.seed(draft);

    // Simulate a race: another request publishes the offer right after this
    // use case's own `findByIdAndRestaurantId` read but before its write.
    const originalUpdateIfDraft = offerRepository.updateIfDraft.bind(offerRepository);
    offerRepository.updateIfDraft = async (offer) => {
      await offerRepository.publishIfDraft(draft.publish(FIXED_NOW));
      return originalUpdateIfDraft(offer);
    };

    await expect(
      useCase.execute({
        actor: orgMemberActor(),
        restaurantId,
        offerId,
        ...testOfferContent({ title: 'Racing Update' }),
      }),
    ).rejects.toBeInstanceOf(InvalidOfferStatusTransitionException);
  });
});
