import { ListPublicOffersUseCase } from './list-public-offers.use-case';
import { FixedClock } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryOfferRepository } from '../../../../../test/offers/support/in-memory-offer.repository';
import {
  testOffer,
  testOfferContent,
} from '../../../../../test/offers/support/offer-test-fixtures';

describe('ListPublicOffersUseCase', () => {
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const publishAt = new Date('2026-08-01T10:00:00.000Z');
  const now = new Date('2026-08-15T00:00:00.000Z');

  async function build() {
    const offerRepository = new InMemoryOfferRepository();
    const useCase = new ListPublicOffersUseCase(offerRepository, new FixedClock(now));
    return { useCase, offerRepository };
  }

  it('returns only Published, currently active, non-deleted offers', async () => {
    const { useCase, offerRepository } = await build();

    const active = testOffer({
      id: '22222222-2222-4222-8222-222222222221',
      restaurantId,
      content: testOfferContent({
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: new Date('2026-08-31T00:00:00.000Z'),
      }),
    }).publish(publishAt);
    await offerRepository.seed(active);

    const draft = testOffer({ id: '22222222-2222-4222-8222-222222222222', restaurantId });
    await offerRepository.seed(draft);

    const future = testOffer({
      id: '22222222-2222-4222-8222-222222222223',
      restaurantId,
      content: testOfferContent({
        startsAt: new Date('2026-09-01T00:00:00.000Z'),
        endsAt: new Date('2026-09-30T00:00:00.000Z'),
      }),
    }).publish(publishAt);
    await offerRepository.seed(future);

    const expired = testOffer({
      id: '22222222-2222-4222-8222-222222222224',
      restaurantId,
      content: testOfferContent({
        startsAt: new Date('2026-06-01T00:00:00.000Z'),
        endsAt: new Date('2026-06-30T00:00:00.000Z'),
      }),
    })
      .publish(new Date('2026-05-01T00:00:00.000Z'))
      .expire(new Date('2026-07-01T00:00:00.000Z'));
    await offerRepository.seed(expired);

    const deleted = testOffer({
      id: '22222222-2222-4222-8222-222222222225',
      restaurantId,
      content: testOfferContent({
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: new Date('2026-08-31T00:00:00.000Z'),
      }),
    })
      .publish(publishAt)
      .softDelete(new Date('2026-08-10T00:00:00.000Z'));
    await offerRepository.seed(deleted);

    const result = await useCase.execute({ restaurantId, page: 1, limit: 20 });

    expect(result.total).toBe(1);
    expect(result.items[0].offerId).toBe(active.offerId.value);
  });

  it('excludes a Published offer whose endsAt has already passed, even before the expiration worker runs', async () => {
    const { useCase, offerRepository } = await build();
    // Still marked `Published` in storage (worker has not fired yet), but
    // `endsAt` is before `now` - must never appear as active.
    const stale = testOffer({
      id: '22222222-2222-4222-8222-222222222226',
      restaurantId,
      content: testOfferContent({
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: new Date('2026-08-14T00:00:00.000Z'),
      }),
    }).publish(publishAt);
    await offerRepository.seed(stale);

    const result = await useCase.execute({ restaurantId, page: 1, limit: 20 });
    expect(result.total).toBe(0);
  });

  it('excludes an offer that has not yet reached startsAt, even if Published', async () => {
    const { useCase, offerRepository } = await build();
    const notYetStarted = testOffer({
      id: '22222222-2222-4222-8222-222222222227',
      restaurantId,
      content: testOfferContent({
        startsAt: new Date('2026-08-16T00:00:00.000Z'),
        endsAt: new Date('2026-08-31T00:00:00.000Z'),
      }),
    }).publish(publishAt);
    await offerRepository.seed(notYetStarted);

    const result = await useCase.execute({ restaurantId, page: 1, limit: 20 });
    expect(result.total).toBe(0);
  });
});
