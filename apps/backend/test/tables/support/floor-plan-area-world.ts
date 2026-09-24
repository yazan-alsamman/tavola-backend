import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { FloorPlan } from '@modules/tables/domain/entities/floor-plan.entity';
import { FloorPlanArea } from '@modules/tables/domain/entities/floor-plan-area.entity';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { InMemoryRestaurantRepository } from '../../restaurants/support/in-memory-restaurant.repository';
import { InMemoryBranchRepository } from '../../branches/support/in-memory-branch.repository';
import { InMemoryFloorPlanRepository } from './in-memory-floor-plan.repository';
import { InMemoryFloorPlanAreaRepository } from './in-memory-floor-plan-area.repository';
import { InMemoryTableRepository } from './in-memory-table.repository';

export const AREA_WORLD_IDS = {
  organizationId: '22222222-2222-4222-8222-222222222222',
  restaurantId: '33333333-3333-4333-8333-333333333333',
  branchId: '44444444-4444-4444-8444-444444444444',
  floorPlanId: '55555555-5555-4555-8555-555555555555',
  otherFloorPlanId: '66666666-6666-4666-8666-666666666666',
  areaId: '77777777-7777-4777-8777-777777777777',
  otherAreaId: '88888888-8888-4888-8888-888888888888',
} as const;

export const AREA_WORLD_NOW = new Date('2026-09-24T12:00:00.000Z');

/**
 * ADR-040 - the Restaurant -> Branch -> FloorPlan chain every FloorPlanArea use
 * case walks before it may touch an area, seeded once here instead of copied
 * into five spec files. A SECOND FloorPlan (`otherFloorPlanId`) is always
 * seeded, because most of the invariants worth testing are about an area of the
 * wrong plan - a world with one plan cannot express them.
 */
export interface FloorPlanAreaWorld {
  restaurantRepository: InMemoryRestaurantRepository;
  branchRepository: InMemoryBranchRepository;
  floorPlanRepository: InMemoryFloorPlanRepository;
  floorPlanAreaRepository: InMemoryFloorPlanAreaRepository;
  tableRepository: InMemoryTableRepository;
}

export function areaWorldActor(): AuthenticatedOrganizationMemberActor {
  return {
    actorType: AccessTokenActorType.OrganizationMember,
    userId: 'user-1',
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
    organizationId: AREA_WORLD_IDS.organizationId,
    orgRole: 'Owner',
    permissionsVersion: 1,
  };
}

export async function buildFloorPlanAreaWorld(): Promise<FloorPlanAreaWorld> {
  const restaurantRepository = new InMemoryRestaurantRepository();
  const branchRepository = new InMemoryBranchRepository();
  const floorPlanRepository = new InMemoryFloorPlanRepository();
  const tableRepository = new InMemoryTableRepository();
  const floorPlanAreaRepository = new InMemoryFloorPlanAreaRepository(tableRepository);

  await restaurantRepository.save(
    Restaurant.create({
      id: AREA_WORLD_IDS.restaurantId,
      organizationId: AREA_WORLD_IDS.organizationId,
      name: 'The Old Mill',
      slug: 'the-old-mill',
      logoId: null,
      coverImageId: null,
      description: null,
      cuisineType: null,
      averageRating: null,
      priceLevel: null,
      status: RestaurantStatus.Active,
      createdAt: AREA_WORLD_NOW,
      updatedAt: AREA_WORLD_NOW,
      deletedAt: null,
    }),
  );

  await branchRepository.save(
    Branch.create({
      id: AREA_WORLD_IDS.branchId,
      restaurantId: AREA_WORLD_IDS.restaurantId,
      city: 'Damascus',
      district: null,
      address: '123 Main St',
      latitude: null,
      longitude: null,
      countryCode: 'SY',
      currency: null,
      timezone: 'Asia/Damascus',
      phone: null,
      createdAt: AREA_WORLD_NOW,
      updatedAt: AREA_WORLD_NOW,
      deletedAt: null,
    }),
  );

  await floorPlanRepository.save(
    FloorPlan.create({
      id: AREA_WORLD_IDS.floorPlanId,
      branchId: AREA_WORLD_IDS.branchId,
      name: 'Main Floor',
      isActive: true,
      createdAt: AREA_WORLD_NOW,
      updatedAt: AREA_WORLD_NOW,
      deletedAt: null,
    }),
  );

  await floorPlanRepository.save(
    FloorPlan.create({
      id: AREA_WORLD_IDS.otherFloorPlanId,
      branchId: AREA_WORLD_IDS.branchId,
      name: 'Patio',
      isActive: false,
      createdAt: AREA_WORLD_NOW,
      updatedAt: AREA_WORLD_NOW,
      deletedAt: null,
    }),
  );

  return {
    restaurantRepository,
    branchRepository,
    floorPlanRepository,
    floorPlanAreaRepository,
    tableRepository,
  };
}

export function seedArea(
  world: FloorPlanAreaWorld,
  overrides: Partial<{
    id: string;
    floorPlanId: string;
    name: string;
    color: string;
    sortOrder: number;
    deletedAt: Date | null;
  }> = {},
): Promise<void> {
  return world.floorPlanAreaRepository.save(
    FloorPlanArea.reconstitute({
      id: overrides.id ?? AREA_WORLD_IDS.areaId,
      floorPlanId: overrides.floorPlanId ?? AREA_WORLD_IDS.floorPlanId,
      name: overrides.name ?? 'Main Hall',
      color: overrides.color ?? '#14B8A6',
      sortOrder: overrides.sortOrder ?? 0,
      createdAt: AREA_WORLD_NOW,
      updatedAt: AREA_WORLD_NOW,
      deletedAt: overrides.deletedAt ?? null,
    }),
  );
}
