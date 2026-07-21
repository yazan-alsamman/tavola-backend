import { ListFloorPlansUseCase } from './list-floor-plans.use-case';
import { CreateFloorPlanUseCase } from './create-floor-plan.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingAuditLogWriter,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryFloorPlanRepository } from '../../../../../test/tables/support/in-memory-floor-plan.repository';

describe('ListFloorPlansUseCase', () => {
  const fixedNow = new Date('2026-07-17T12:00:00.000Z');
  const organizationId = '22222222-2222-4222-8222-222222222222';
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';

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

  async function seed(
    restaurantRepository: InMemoryRestaurantRepository,
    branchRepository: InMemoryBranchRepository,
  ): Promise<void> {
    await restaurantRepository.save(
      Restaurant.create({
        id: restaurantId,
        organizationId,
        name: 'The Old Mill',
        slug: 'the-old-mill',
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
      }),
    );
    await branchRepository.save(
      Branch.create({
        id: branchId,
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
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );
  }

  function build() {
    const floorPlanRepository = new InMemoryFloorPlanRepository();
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const listUseCase = new ListFloorPlansUseCase(
      floorPlanRepository,
      branchRepository,
      restaurantRepository,
    );
    const createUseCase = new CreateFloorPlanUseCase(
      floorPlanRepository,
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([
        '11111111-1111-4111-8111-111111111111',
        '55555555-5555-4555-8555-555555555555',
      ]),
      new CollectingAuditLogWriter(),
    );
    return { listUseCase, createUseCase, branchRepository, restaurantRepository };
  }

  it('lists every floor plan for the branch', async () => {
    const { listUseCase, createUseCase, branchRepository, restaurantRepository } = build();
    await seed(restaurantRepository, branchRepository);
    await createUseCase.execute({ actor: baseActor(), restaurantId, branchId, name: 'Main Floor' });
    await createUseCase.execute({ actor: baseActor(), restaurantId, branchId, name: 'Patio' });

    const result = await listUseCase.execute({ actor: baseActor(), restaurantId, branchId });

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.name)).toEqual(['Main Floor', 'Patio']);
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const { listUseCase } = build();
    await expect(
      listUseCase.execute({ actor: baseActor(), restaurantId, branchId }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('throws BranchNotFoundException when the branch does not exist', async () => {
    const { listUseCase, restaurantRepository } = build();
    await restaurantRepository.save(
      Restaurant.create({
        id: restaurantId,
        organizationId,
        name: 'The Old Mill',
        slug: 'the-old-mill',
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
      }),
    );

    await expect(
      listUseCase.execute({ actor: baseActor(), restaurantId, branchId }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });
});
