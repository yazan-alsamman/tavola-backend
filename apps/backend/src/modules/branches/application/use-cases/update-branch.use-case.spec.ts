import { UpdateBranchUseCase } from './update-branch.use-case';
import { CreateBranchUseCase } from './create-branch.use-case';
import { BranchUpdatedEvent } from '../../domain/events/branch.events';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '../../domain/exceptions/branch-not-found.exception';
import { InvalidBranchCoordinatesException } from '../../domain/exceptions/invalid-branch-coordinates.exception';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
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

describe('UpdateBranchUseCase', () => {
  const fixedNow = new Date('2026-07-16T12:00:00.000Z');
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';
  const otherRestaurantId = '55555555-5555-4555-8555-555555555555';

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
  ): Promise<void> {
    const restaurant = Restaurant.create({
      id,
      organizationId,
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

  async function setup() {
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    await seedRestaurant(restaurantRepository, restaurantId);
    await seedRestaurant(restaurantRepository, otherRestaurantId);

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
    await restaurantUsageRepository.create(
      RestaurantUsage.create({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        restaurantId,
        now: fixedNow,
      }),
    );
    const createUseCase = new CreateBranchUseCase(
      branchRepository,
      restaurantRepository,
      restaurantUsageRepository,
      subscriptionRepository,
      subscriptionPlanRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ]),
      new CollectingEventPublisher(),
      new ImmediateUnitOfWork(),
    );
    const created = await createUseCase.execute({
      actor: baseActor(),
      restaurantId,
      city: 'Damascus',
      district: null,
      address: '123 Main St',
      latitude: null,
      longitude: null,
      countryCode: 'SY',
      currency: null,
      timezone: 'Asia/Damascus',
      phone: null,
    });

    const eventPublisher = new CollectingEventPublisher();
    const useCase = new UpdateBranchUseCase(
      branchRepository,
      restaurantRepository,
      new FixedClock(new Date('2026-07-17T09:00:00.000Z')),
      new SequentialIdGenerator(['33333333-3333-4333-8333-333333333334']),
      eventPublisher,
    );
    return { useCase, branchRepository, eventPublisher, created };
  }

  const updateFields = {
    city: 'Aleppo',
    district: 'Downtown',
    address: '456 New St',
    latitude: null,
    longitude: null,
    countryCode: 'SY',
    currency: 'USD',
    timezone: 'Asia/Damascus',
    phone: '+963911111111',
  };

  it('full-replaces the branch profile fields', async () => {
    const { useCase, created } = await setup();

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId: created.branchId,
      ...updateFields,
    });

    expect(result).toMatchObject({ branchId: created.branchId, restaurantId, ...updateFields });
  });

  it('publishes exactly one BranchUpdatedEvent', async () => {
    const { useCase, eventPublisher, created } = await setup();

    await useCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId: created.branchId,
      ...updateFields,
      correlationId: 'corr-2',
    });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as BranchUpdatedEvent;
    expect(event).toBeInstanceOf(BranchUpdatedEvent);
    expect(event.payload).toMatchObject({
      branchId: created.branchId,
      restaurantId,
      organizationId,
    });
  });

  it('throws BranchNotFoundException when updating via a different restaurant (IDOR)', async () => {
    const { useCase, created } = await setup();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: otherRestaurantId,
        branchId: created.branchId,
        ...updateFields,
      }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const useCase = new UpdateBranchUseCase(
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator(['55555555-5555-4555-8555-555555555556']),
      new CollectingEventPublisher(),
    );

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: '77777777-7777-4777-8777-777777777777',
        branchId: '66666666-6666-4666-8666-666666666666',
        ...updateFields,
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('updates a branch with valid coordinates', async () => {
    const { useCase, created } = await setup();

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId: created.branchId,
      ...updateFields,
      latitude: 33.5138,
      longitude: 36.2765,
    });

    expect(result.latitude).toBe(33.5138);
    expect(result.longitude).toBe(36.2765);
  });

  it('throws InvalidBranchCoordinatesException when only longitude is provided', async () => {
    const { useCase, created } = await setup();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        branchId: created.branchId,
        ...updateFields,
        latitude: null,
        longitude: 36.2765,
      }),
    ).rejects.toBeInstanceOf(InvalidBranchCoordinatesException);
  });
});
