import { ListDiscoverableOffersUseCase } from './list-discoverable-offers.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { ListPublicOffersUseCase } from '@modules/offers/application/use-cases/list-public-offers.use-case';
import { FakeDiscoveryReader } from '../../../../../test/discovery/support/fake-discovery-reader';
import { InMemoryOfferRepository } from '../../../../../test/offers/support/in-memory-offer.repository';
import { FixedClock } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import {
  testOffer,
  testOfferContent,
} from '../../../../../test/offers/support/offer-test-fixtures';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';

const restaurantId = '11111111-1111-4111-8111-111111111111';

function restaurant(): RestaurantResult {
  return {
    restaurantId,
    name: 'The Old Mill',
    slug: 'the-old-mill',
    logoId: null,
    coverImageId: null,
    description: null,
    cuisineType: null,
    averageRating: null,
    priceLevel: null,
    status: 'Active',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('ListDiscoverableOffersUseCase', () => {
  const now = new Date('2026-08-15T00:00:00.000Z');

  it('delegates to ListPublicOffersUseCase once the restaurant is confirmed discoverable', async () => {
    const discoveryReader = new FakeDiscoveryReader();
    discoveryReader.restaurants = [restaurant()];

    const offerRepository = new InMemoryOfferRepository();
    const active = testOffer({
      id: '22222222-2222-4222-8222-222222222221',
      restaurantId,
      content: testOfferContent({
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: new Date('2026-08-31T00:00:00.000Z'),
      }),
    }).publish(new Date('2026-08-01T10:00:00.000Z'));
    await offerRepository.seed(active);

    const listPublicOffersUseCase = new ListPublicOffersUseCase(
      offerRepository,
      new FixedClock(now),
    );
    const useCase = new ListDiscoverableOffersUseCase(discoveryReader, listPublicOffersUseCase);

    const result = await useCase.execute({ restaurantId, page: 1, limit: 20 });
    expect(result.total).toBe(1);
    expect(result.items[0].offerId).toBe(active.offerId.value);
  });

  it('404s when the restaurant is not discoverable, without ever calling the Offers module', async () => {
    const discoveryReader = new FakeDiscoveryReader();
    const offerRepository = new InMemoryOfferRepository();
    const listPublicOffersUseCase = new ListPublicOffersUseCase(
      offerRepository,
      new FixedClock(now),
    );
    const useCase = new ListDiscoverableOffersUseCase(discoveryReader, listPublicOffersUseCase);

    await expect(useCase.execute({ restaurantId, page: 1, limit: 20 })).rejects.toBeInstanceOf(
      RestaurantNotFoundException,
    );
  });
});
