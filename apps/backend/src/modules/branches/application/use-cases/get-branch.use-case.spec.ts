import { GetBranchUseCase } from './get-branch.use-case';
import { CreateBranchUseCase } from './create-branch.use-case';
import { DeleteBranchUseCase } from './delete-branch.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '../../domain/exceptions/branch-not-found.exception';
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
import { InMemoryFloorPlanRepository } from '../../../../../test/tables/support/in-memory-floor-plan.repository';
import { InMemoryTableRepository } from '../../../../../test/tables/support/in-memory-table.repository';

describe('GetBranchUseCase', () => {
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

  async function setup() {
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    await seedRestaurant(restaurantRepository, restaurantId, organizationId);
    await seedRestaurant(restaurantRepository, otherRestaurantId, organizationId);

    const createUseCase = new CreateBranchUseCase(
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([
        '11111111-1111-4111-8111-111111111111',
        '55555555-5555-4555-8555-555555555556',
      ]),
      new CollectingEventPublisher(),
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

    const useCase = new GetBranchUseCase(branchRepository, restaurantRepository);
    const deleteUseCase = new DeleteBranchUseCase(
      branchRepository,
      restaurantRepository,
      new InMemoryFloorPlanRepository(),
      new InMemoryTableRepository(),
      new FixedClock(fixedNow),
      new SequentialIdGenerator(['44444444-4444-4444-8444-444444444445']),
      new CollectingEventPublisher(),
      new ImmediateUnitOfWork(),
    );
    return { useCase, deleteUseCase, created };
  }

  it('returns the branch when it belongs to the given restaurant', async () => {
    const { useCase, created } = await setup();

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId: created.branchId,
    });

    expect(result.branchId).toBe(created.branchId);
    expect(result.city).toBe('Damascus');
  });

  it('throws BranchNotFoundException when the branch belongs to a different restaurant (IDOR)', async () => {
    const { useCase, created } = await setup();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: otherRestaurantId,
        branchId: created.branchId,
      }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });

  it('throws BranchNotFoundException for an unknown branchId', async () => {
    const { useCase } = await setup();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        branchId: '66666666-6666-4666-8666-666666666666',
      }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const useCase = new GetBranchUseCase(branchRepository, restaurantRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: '77777777-7777-4777-8777-777777777777',
        branchId: '66666666-6666-4666-8666-666666666666',
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('throws BranchNotFoundException for an already soft-deleted branch', async () => {
    const { useCase, deleteUseCase, created } = await setup();

    await deleteUseCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId: created.branchId,
    });

    await expect(
      useCase.execute({ actor: baseActor(), restaurantId, branchId: created.branchId }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });
});
