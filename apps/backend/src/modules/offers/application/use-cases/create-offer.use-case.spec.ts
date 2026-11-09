import { CreateOfferUseCase } from './create-offer.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { OfferType, OfferDiscountType, OfferStatus } from '../../domain/enums/offer.enums';
import { OfferCreatedEvent } from '../../domain/events/offer.events';
import { OfferId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryOfferRepository } from '../../../../../test/offers/support/in-memory-offer.repository';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InvalidOfferException } from '../../domain/exceptions/invalid-offer.exception';
import {
  FIXED_NOW,
  noConditions,
  orgMemberActor,
  testRestaurant,
} from '../../../../../test/offers/support/offer-test-fixtures';

describe('CreateOfferUseCase', () => {
  const restaurantId = '33333333-3333-4333-8333-333333333333';

  async function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const offerRepository = new InMemoryOfferRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new CreateOfferUseCase(
      restaurantRepository,
      offerRepository,
      new InMemoryBranchRepository(),
      new FixedClock(FIXED_NOW),
      new SequentialIdGenerator([
        'aaaaaaaa-0001-4000-8000-000000000001',
        'aaaaaaaa-0001-4000-8000-000000000002',
      ]),
      eventPublisher,
      new ImmediateUnitOfWork(),
    );
    return { useCase, restaurantRepository, offerRepository, eventPublisher };
  }

  it('creates a Draft offer and publishes OfferCreated', async () => {
    const { useCase, restaurantRepository, offerRepository, eventPublisher } = await build();
    await restaurantRepository.save(testRestaurant({ id: restaurantId }));

    const result = await useCase.execute({
      actor: orgMemberActor(),
      restaurantId,
      type: OfferType.Promotion,
      title: '20% Off Weekday Lunch',
      description: 'Enjoy 20% off any lunch entree.',
      discountType: OfferDiscountType.Percentage,
      discountValue: 20,
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      endsAt: new Date('2026-08-31T23:59:59.000Z'),
      conditions: { ...noConditions(), daysOfWeek: [5, 4], startTime: '12:00', endTime: '16:00' },
    });

    expect(result.status).toBe(OfferStatus.Draft);
    expect(result.restaurantId).toBe(restaurantId);
    expect(result.daysOfWeek).toEqual([4, 5]);
    expect(result.startTime).toBe('12:00');

    const stored = await offerRepository.findByIdAndRestaurantId(
      OfferId.create(result.offerId),
      RestaurantId.create(restaurantId),
    );
    expect(stored).not.toBeNull();

    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(OfferCreatedEvent);
    const event = eventPublisher.events[0] as OfferCreatedEvent;
    expect(event.payload.restaurantId).toBe(restaurantId);
    expect(event.payload.createdByUserId).toBe(orgMemberActor().userId);
  });

  it('404s when the restaurant does not exist (or belongs to another organization)', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: orgMemberActor(),
        restaurantId,
        type: OfferType.Promotion,
        title: 'Title',
        description: 'Description',
        discountType: OfferDiscountType.Percentage,
        discountValue: 20,
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: new Date('2026-08-31T23:59:59.000Z'),
        conditions: noConditions(),
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('rejects (400) a branch that is not one of the restaurant', async () => {
    const { useCase, restaurantRepository } = await build();
    await restaurantRepository.save(testRestaurant({ id: restaurantId }));
    await expect(
      useCase.execute({
        actor: orgMemberActor(),
        restaurantId,
        type: OfferType.QuietDays,
        title: 'Quiet Tuesday',
        description: 'Midweek discount.',
        discountType: OfferDiscountType.Percentage,
        discountValue: 15,
        startsAt: new Date('2026-08-01T00:00:00.000Z'),
        endsAt: new Date('2026-08-31T23:59:59.000Z'),
        conditions: { ...noConditions(), branchIds: ['bbbbbbbb-0001-4000-8000-000000000009'] },
      }),
    ).rejects.toBeInstanceOf(InvalidOfferException);
  });
});
