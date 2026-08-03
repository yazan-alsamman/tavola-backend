import { ListRestaurantOffersUseCase } from './list-restaurant-offers.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { OfferStatus } from '../../domain/enums/offer.enums';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryOfferRepository } from '../../../../../test/offers/support/in-memory-offer.repository';
import {
  orgMemberActor,
  testOffer,
  testRestaurant,
} from '../../../../../test/offers/support/offer-test-fixtures';

describe('ListRestaurantOffersUseCase', () => {
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const fixedNow = new Date('2026-08-05T00:00:00.000Z');

  async function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const offerRepository = new InMemoryOfferRepository();
    await restaurantRepository.save(testRestaurant({ id: restaurantId }));
    const useCase = new ListRestaurantOffersUseCase(restaurantRepository, offerRepository);
    return { useCase, offerRepository };
  }

  it('lists every status (Draft/Published/Expired), unlike the public listing', async () => {
    const { useCase, offerRepository } = await build();
    await offerRepository.seed(
      testOffer({ id: '22222222-2222-4222-8222-222222222221', restaurantId }),
    );
    await offerRepository.seed(
      testOffer({ id: '22222222-2222-4222-8222-222222222222', restaurantId }).publish(fixedNow),
    );
    await offerRepository.seed(
      testOffer({ id: '22222222-2222-4222-8222-222222222223', restaurantId })
        .publish(fixedNow)
        .expire(new Date('2026-09-15T00:00:00.000Z')),
    );

    const result = await useCase.execute({
      actor: orgMemberActor(),
      restaurantId,
      page: 1,
      limit: 20,
    });

    expect(result.total).toBe(3);
    const statuses = result.items.map((item) => item.status).sort();
    expect(statuses).toEqual(
      [OfferStatus.Draft, OfferStatus.Expired, OfferStatus.Published].sort(),
    );
  });

  it('excludes soft-deleted offers', async () => {
    const { useCase, offerRepository } = await build();
    const offer = testOffer({ id: '22222222-2222-4222-8222-222222222221', restaurantId });
    await offerRepository.seed(offer.softDelete(fixedNow));

    const result = await useCase.execute({
      actor: orgMemberActor(),
      restaurantId,
      page: 1,
      limit: 20,
    });
    expect(result.total).toBe(0);
  });

  it('404s when the restaurant does not exist', async () => {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const offerRepository = new InMemoryOfferRepository();
    const useCase = new ListRestaurantOffersUseCase(restaurantRepository, offerRepository);
    await expect(
      useCase.execute({ actor: orgMemberActor(), restaurantId, page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
