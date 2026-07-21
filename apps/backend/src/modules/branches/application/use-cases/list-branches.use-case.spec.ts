import { randomUUID } from 'crypto';
import { ListBranchesUseCase } from './list-branches.use-case';
import { CreateBranchUseCase } from './create-branch.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingEventPublisher,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';

describe('ListBranchesUseCase', () => {
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

  async function seedBranches(
    branchRepository: InMemoryBranchRepository,
    restaurantRepository: InMemoryRestaurantRepository,
    forRestaurantId: string,
    count: number,
  ): Promise<void> {
    const createUseCase = new CreateBranchUseCase(
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator(Array.from({ length: count * 2 }, () => randomUUID())),
      new CollectingEventPublisher(),
    );
    for (let i = 0; i < count; i += 1) {
      await createUseCase.execute({
        actor: baseActor(),
        restaurantId: forRestaurantId,
        city: `City ${i}`,
        district: null,
        address: `${i} Main St`,
        latitude: null,
        longitude: null,
        countryCode: 'SY',
        currency: null,
        timezone: 'Asia/Damascus',
        phone: null,
      });
    }
  }

  it('lists only branches belonging to the given restaurant', async () => {
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    await seedRestaurant(restaurantRepository, restaurantId);
    await seedRestaurant(restaurantRepository, otherRestaurantId);
    await seedBranches(branchRepository, restaurantRepository, restaurantId, 3);
    await seedBranches(branchRepository, restaurantRepository, otherRestaurantId, 2);

    const useCase = new ListBranchesUseCase(branchRepository, restaurantRepository);
    const result = await useCase.execute({ actor: baseActor(), restaurantId, page: 1, limit: 20 });

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
    expect(result.items.every((item) => item.restaurantId === restaurantId)).toBe(true);
  });

  it('paginates results', async () => {
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    await seedRestaurant(restaurantRepository, restaurantId);
    await seedBranches(branchRepository, restaurantRepository, restaurantId, 3);

    const useCase = new ListBranchesUseCase(branchRepository, restaurantRepository);
    const result = await useCase.execute({ actor: baseActor(), restaurantId, page: 1, limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(2);
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const useCase = new ListBranchesUseCase(branchRepository, restaurantRepository);

    await expect(
      useCase.execute({ actor: baseActor(), restaurantId, page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
