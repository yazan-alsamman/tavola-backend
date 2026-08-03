import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';

export const FIXED_NOW = new Date('2026-08-03T10:00:00.000Z');
export const RESTAURANT_ID = '33333333-3333-4333-8333-333333333333';
export const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111199';

export function testRestaurant(overrides?: { id?: string; organizationId?: string }): Restaurant {
  return Restaurant.create({
    id: overrides?.id ?? RESTAURANT_ID,
    organizationId: overrides?.organizationId ?? ORGANIZATION_ID,
    name: 'The Old Mill',
    slug: 'the-old-mill',
    logoId: null,
    coverImageId: null,
    description: null,
    cuisineType: null,
    averageRating: null,
    priceLevel: null,
    status: RestaurantStatus.Active,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    deletedAt: null,
  });
}

export function ownerActor(overrides?: { userId?: string; organizationId?: string }) {
  return {
    actorType: AccessTokenActorType.OrganizationMember as const,
    userId: overrides?.userId ?? '11111111-1111-4111-8111-111111111111',
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
    organizationId: overrides?.organizationId ?? ORGANIZATION_ID,
    orgRole: 'Owner',
    permissionsVersion: 1,
  };
}

export function memberActor(overrides?: { organizationId?: string }) {
  return {
    actorType: AccessTokenActorType.OrganizationMember as const,
    userId: '11111111-1111-4111-8111-111111111112',
    sessionId: 'session-2',
    sessionVersion: 1,
    tokenFamilyId: 'family-2',
    organizationId: overrides?.organizationId ?? ORGANIZATION_ID,
    orgRole: 'Member',
    permissionsVersion: 1,
  };
}

export function employeeActor(overrides?: {
  restaurantId?: string;
  permissions?: string[];
  employeeId?: string;
}) {
  return {
    actorType: AccessTokenActorType.Employee as const,
    userId: overrides?.employeeId ?? '22222222-2222-4222-8222-222222222222',
    employeeId: overrides?.employeeId ?? '22222222-2222-4222-8222-222222222222',
    sessionId: 'session-3',
    sessionVersion: 1,
    tokenFamilyId: 'family-3',
    organizationId: ORGANIZATION_ID,
    restaurantId: overrides?.restaurantId ?? RESTAURANT_ID,
    branchIds: [],
    permissions: overrides?.permissions ?? ['menu:manage'],
    permissionsVersion: 1,
  };
}

export function customerActor() {
  return {
    actorType: AccessTokenActorType.User as const,
    userId: '44444444-4444-4444-8444-444444444444',
    sessionId: 'session-4',
    sessionVersion: 1,
    tokenFamilyId: 'family-4',
  };
}
