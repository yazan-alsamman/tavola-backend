import { CreateBranchUseCase } from './create-branch.use-case';
import { BranchCreatedEvent } from '../../domain/events/branch.events';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { InvalidBranchCoordinatesException } from '../../domain/exceptions/invalid-branch-coordinates.exception';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { RestaurantUsage } from '@modules/restaurants/domain/entities/restaurant-usage.entity';
import { createPermissiveSubscriptionFixture } from '../../../../../test/subscriptions/support/permissive-subscription-fixture';

describe('CreateBranchUseCase', () => {
  const fixedNow = new Date('2026-07-16T12:00:00.000Z');
  const branchId = '11111111-1111-4111-8111-111111111111';
  const eventId = '22222222-2222-4222-8222-222222222222';
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';

  function baseActor() {
    return {
      actorType: AccessTokenActorType.OrganizationMember as const,
      userId: 'user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      organizationId,
      orgRole: 'Owner',
      permissionsVersion: 1,
    };
  }

  async function seedRestaurant(
    restaurantRepository: InMemoryRestaurantRepository,
    id: string,
    orgId: string,
  ): Promise<void> {
    const restaurant = Restaurant.create({
      id,
      organizationId: orgId,
      name: 'The Old Mill',
      slug: `the-old-mill-${id}`,
      logoId: null,
      coverImageId: null,
      description: null,
      cuisineType: null,
      averageRating: null,
      priceLevel: null,
      status: RestaurantStatus.Active,
      createdAt: fixedNow,
      updatedAt: fixedNow,
      deletedAt: null,
    });
    await restaurantRepository.save(restaurant);
  }

  function createUseCase() {
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const eventPublisher = new CollectingEventPublisher();
    const { subscriptionRepository, subscriptionPlanRepository, restaurantUsageRepository } =
      createPermissiveSubscriptionFixture(
        organizationId,
        {
          planId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          subscriptionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          usageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        },
        fixedNow,
      );
    void restaurantUsageRepository.create(
      RestaurantUsage.create({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        restaurantId,
        now: fixedNow,
      }),
    );
    const useCase = new CreateBranchUseCase(
      branchRepository,
      restaurantRepository,
      restaurantUsageRepository,
      subscriptionRepository,
      subscriptionPlanRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([branchId, eventId]),
      eventPublisher,
      new ImmediateUnitOfWork(),
    );
    return { useCase, branchRepository, restaurantRepository, eventPublisher };
  }

  const validCommand = {
    actor: baseActor(),
    restaurantId,
    city: 'Damascus',
    district: 'Malki',
    address: '123 Main St',
    latitude: null,
    longitude: null,
    countryCode: 'SY',
    currency: 'SYP',
    timezone: 'Asia/Damascus',
    phone: '+963900000000',
  };

  it('creates a branch scoped to the given restaurant', async () => {
    const { useCase, restaurantRepository, branchRepository } = createUseCase();
    await seedRestaurant(restaurantRepository, restaurantId, organizationId);

    const result = await useCase.execute(validCommand);

    expect(result.branchId).toBe(branchId);
    expect(result.restaurantId).toBe(restaurantId);
    expect(result.city).toBe('Damascus');
    expect(result.countryCode).toBe('SY');

    const persisted = await branchRepository.findByIdAndRestaurantId(
      BranchId.create(branchId),
      RestaurantId.create(restaurantId),
    );
    expect(persisted).not.toBeNull();
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const { useCase } = createUseCase();

    await expect(useCase.execute(validCommand)).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('publishes exactly one BranchCreatedEvent carrying the actor, restaurant, and organization', async () => {
    const { useCase, restaurantRepository, eventPublisher } = createUseCase();
    await seedRestaurant(restaurantRepository, restaurantId, organizationId);

    await useCase.execute({ ...validCommand, correlationId: 'corr-1' });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as BranchCreatedEvent;
    expect(event).toBeInstanceOf(BranchCreatedEvent);
    expect(event.payload).toMatchObject({
      branchId,
      restaurantId,
      organizationId,
      actorId: 'user-1',
    });
    expect(event.correlationId).toBe('corr-1');
  });

  it('accepts null district, currency, and phone', async () => {
    const { useCase, restaurantRepository } = createUseCase();
    await seedRestaurant(restaurantRepository, restaurantId, organizationId);

    const result = await useCase.execute({
      ...validCommand,
      district: null,
      currency: null,
      phone: null,
    });

    expect(result.district).toBeNull();
    expect(result.currency).toBeNull();
    expect(result.phone).toBeNull();
  });

  it('creates a branch with valid coordinates', async () => {
    const { useCase, restaurantRepository } = createUseCase();
    await seedRestaurant(restaurantRepository, restaurantId, organizationId);

    const result = await useCase.execute({
      ...validCommand,
      latitude: 33.5138,
      longitude: 36.2765,
    });

    expect(result.latitude).toBe(33.5138);
    expect(result.longitude).toBe(36.2765);
  });

  it('throws InvalidBranchCoordinatesException when only latitude is provided', async () => {
    const { useCase, restaurantRepository } = createUseCase();
    await seedRestaurant(restaurantRepository, restaurantId, organizationId);

    await expect(
      useCase.execute({ ...validCommand, latitude: 33.5138, longitude: null }),
    ).rejects.toBeInstanceOf(InvalidBranchCoordinatesException);
  });

  it('throws InvalidBranchCoordinatesException for an out-of-range latitude', async () => {
    const { useCase, restaurantRepository } = createUseCase();
    await seedRestaurant(restaurantRepository, restaurantId, organizationId);

    await expect(
      useCase.execute({ ...validCommand, latitude: 91, longitude: 36.2765 }),
    ).rejects.toBeInstanceOf(InvalidBranchCoordinatesException);
  });
});
