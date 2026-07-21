import { ActivateFloorPlanUseCase } from './activate-floor-plan.use-case';
import { CreateFloorPlanUseCase } from './create-floor-plan.use-case';
import { FloorPlanNotFoundException } from '../../domain/exceptions/floor-plan-not-found.exception';
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
import { FloorPlanId, BranchId } from '@shared/domain/value-objects/identifiers.vo';

describe('ActivateFloorPlanUseCase', () => {
  const fixedNow = new Date('2026-07-17T12:00:00.000Z');
  const organizationId = '22222222-2222-4222-8222-222222222222';
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const mainFloorId = '11111111-1111-4111-8111-111111111111';
  const patioId = '55555555-5555-4555-8555-555555555555';

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

  async function build() {
    const floorPlanRepository = new InMemoryFloorPlanRepository();
    const branchRepository = new InMemoryBranchRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();

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

    const createUseCase = new CreateFloorPlanUseCase(
      floorPlanRepository,
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([mainFloorId, patioId]),
      new CollectingAuditLogWriter(),
    );
    await createUseCase.execute({ actor: baseActor(), restaurantId, branchId, name: 'Main Floor' });
    await createUseCase.execute({ actor: baseActor(), restaurantId, branchId, name: 'Patio' });

    const auditLogWriter = new CollectingAuditLogWriter();
    const useCase = new ActivateFloorPlanUseCase(
      floorPlanRepository,
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      auditLogWriter,
    );
    return { useCase, floorPlanRepository, auditLogWriter };
  }

  it('activates the target and atomically deactivates the previously active one', async () => {
    const { useCase, floorPlanRepository } = await build();

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId,
      floorPlanId: patioId,
    });

    expect(result.isActive).toBe(true);

    const mainFloor = await floorPlanRepository.findByIdAndBranchId(
      FloorPlanId.create(mainFloorId),
      BranchId.create(branchId),
    );
    expect(mainFloor?.isActive).toBe(false);
  });

  it('throws FloorPlanNotFoundException for an unknown floor plan', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        branchId,
        floorPlanId: '99999999-9999-4999-8999-999999999999',
      }),
    ).rejects.toBeInstanceOf(FloorPlanNotFoundException);
  });

  it('writes a floor_plan.activated audit entry', async () => {
    const { useCase, auditLogWriter } = await build();

    await useCase.execute({ actor: baseActor(), restaurantId, branchId, floorPlanId: patioId });

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'floor_plan.activated',
      targetId: patioId,
      organizationId,
    });
  });
});
