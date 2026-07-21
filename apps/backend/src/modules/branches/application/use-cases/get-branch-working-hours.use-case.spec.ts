import { GetBranchWorkingHoursUseCase } from './get-branch-working-hours.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '../../domain/exceptions/branch-not-found.exception';
import { Branch } from '../../domain/entities/branch.entity';
import { BranchWorkingHours } from '../../domain/entities/branch-working-hours.entity';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryBranchWorkingHoursRepository } from '../../../../../test/branches/support/in-memory-branch-working-hours.repository';

describe('GetBranchWorkingHoursUseCase', () => {
  const fixedNow = new Date('2026-07-16T12:00:00.000Z');
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';
  const otherRestaurantId = '55555555-5555-4555-8555-555555555555';
  const branchId = '66666666-6666-4666-8666-666666666666';

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

  function buildRestaurant(id: string): Restaurant {
    return Restaurant.create({
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
  }

  function buildBranch(id: string, forRestaurantId: string): Branch {
    return Branch.create({
      id,
      restaurantId: forRestaurantId,
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
    });
  }

  async function setup() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const branchRepository = new InMemoryBranchRepository();
    const branchWorkingHoursRepository = new InMemoryBranchWorkingHoursRepository();
    await restaurantRepository.save(buildRestaurant(restaurantId));
    await restaurantRepository.save(buildRestaurant(otherRestaurantId));
    await branchRepository.save(buildBranch(branchId, restaurantId));

    const useCase = new GetBranchWorkingHoursUseCase(
      restaurantRepository,
      branchRepository,
      branchWorkingHoursRepository,
    );
    return { useCase, branchWorkingHoursRepository };
  }

  it('returns an empty entries array when no rows exist yet', async () => {
    const { useCase } = await setup();

    const result = await useCase.execute({ actor: baseActor(), restaurantId, branchId });

    expect(result).toEqual({ branchId, entries: [] });
  });

  it('returns entries sorted by dayOfWeek', async () => {
    const { useCase, branchWorkingHoursRepository } = await setup();
    await branchWorkingHoursRepository.replaceAllForBranch(BranchId.create(branchId), [
      BranchWorkingHours.create({
        id: 'a1111111-1111-4111-8111-111111111111',
        branchId,
        dayOfWeek: 5,
        openingTime: '09:00',
        closingTime: '22:00',
        breakStartTime: null,
        breakEndTime: null,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
      BranchWorkingHours.create({
        id: 'a2222222-2222-4222-8222-222222222222',
        branchId,
        dayOfWeek: 1,
        openingTime: '10:00',
        closingTime: '20:00',
        breakStartTime: null,
        breakEndTime: null,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
    ]);

    const result = await useCase.execute({ actor: baseActor(), restaurantId, branchId });

    expect(result.entries.map((e) => e.dayOfWeek)).toEqual([1, 5]);
  });

  it('throws BranchNotFoundException when the branch belongs to a different restaurant (IDOR)', async () => {
    const { useCase } = await setup();

    await expect(
      useCase.execute({ actor: baseActor(), restaurantId: otherRestaurantId, branchId }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const branchRepository = new InMemoryBranchRepository();
    const branchWorkingHoursRepository = new InMemoryBranchWorkingHoursRepository();
    const useCase = new GetBranchWorkingHoursUseCase(
      restaurantRepository,
      branchRepository,
      branchWorkingHoursRepository,
    );

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: '77777777-7777-4777-8777-777777777777',
        branchId,
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
