import { ListRestaurantIdsWithActiveOfferUseCase } from './list-restaurant-ids-with-active-offer.use-case';
import { FixedClock } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryOfferRepository } from '../../../../../test/offers/support/in-memory-offer.repository';
import {
  testOffer,
  testOfferContent,
} from '../../../../../test/offers/support/offer-test-fixtures';

describe('ListRestaurantIdsWithActiveOfferUseCase', () => {
  const restaurantWithActiveOffer = '33333333-3333-4333-8333-333333333331';
  const restaurantWithOnlyDraftOffer = '33333333-3333-4333-8333-333333333332';
  const restaurantWithNoOffer = '33333333-3333-4333-8333-333333333333';
  const publishAt = new Date('2026-08-01T10:00:00.000Z');
  const now = new Date('2026-08-15T00:00:00.000Z');

  async function build() {
    const offerRepository = new InMemoryOfferRepository();
    const useCase = new ListRestaurantIdsWithActiveOfferUseCase(
      offerRepository,
      new FixedClock(now),
    );
    return { useCase, offerRepository };
  }

  it('returns only restaurantIds with at least one Published, currently active, non-deleted offer', async () => {
    const { useCase, offerRepository } = await build();

    const active = testOffer({
      id: '22222222-2222-4222-8222-222222222221',
      restaurantId: restaurantWithActiveOffer,
      content: testOfferContent({
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: new Date('2026-08-31T00:00:00.000Z'),
      }),
    }).publish(publishAt);
    await offerRepository.seed(active);

    const draft = testOffer({
      id: '22222222-2222-4222-8222-222222222222',
      restaurantId: restaurantWithOnlyDraftOffer,
    });
    await offerRepository.seed(draft);

    const result = await useCase.execute({
      restaurantIds: [
        restaurantWithActiveOffer,
        restaurantWithOnlyDraftOffer,
        restaurantWithNoOffer,
      ],
    });

    expect(result.has(restaurantWithActiveOffer)).toBe(true);
    expect(result.has(restaurantWithOnlyDraftOffer)).toBe(false);
    expect(result.has(restaurantWithNoOffer)).toBe(false);
    expect(result.size).toBe(1);
  });

  it('excludes a restaurant whose only Published offer has already passed endsAt', async () => {
    const { useCase, offerRepository } = await build();
    const stale = testOffer({
      id: '22222222-2222-4222-8222-222222222226',
      restaurantId: restaurantWithActiveOffer,
      content: testOfferContent({
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: new Date('2026-08-14T00:00:00.000Z'),
      }),
    }).publish(publishAt);
    await offerRepository.seed(stale);

    const result = await useCase.execute({ restaurantIds: [restaurantWithActiveOffer] });
    expect(result.size).toBe(0);
  });

  it('does not query the repository and returns an empty set for an empty input list', async () => {
    const { useCase, offerRepository } = await build();
    const spy = jest.spyOn(offerRepository, 'findRestaurantIdsWithActivePublicOffer');

    const result = await useCase.execute({ restaurantIds: [] });

    expect(result.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
