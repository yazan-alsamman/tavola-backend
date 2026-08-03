import { GetReviewsSummaryUseCase } from './get-reviews-summary.use-case';
import { AnalyticsQueryPort } from '../ports/analytics-query.port';
import { RestaurantRepository } from '@modules/restaurants/domain/repositories/restaurant.repository';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { REPORTS_VIEW_PERMISSION } from '../services/assert-actor-can-view-analytics';
import { ClockPort } from '@shared/application/ports/clock.port';

const NOW = new Date('2026-07-28T12:00:00.000Z');
const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';

const OWNER_ACTOR = {
  actorType: AccessTokenActorType.OrganizationMember as const,
  userId: 'user-1',
  sessionId: 'session-1',
  sessionVersion: 1,
  tokenFamilyId: 'family-1',
  organizationId: 'org-1',
  orgRole: OrganizationMemberRole.Owner,
  permissionsVersion: 1,
};

const STAFF_ACTOR = {
  ...OWNER_ACTOR,
  userId: 'user-2',
  orgRole: OrganizationMemberRole.Staff,
};

function buildRestaurant(averageRating: number | null = 4.5): Restaurant {
  return Restaurant.reconstitute({
    id: RESTAURANT_ID,
    organizationId: 'org-1',
    name: 'The Old Mill',
    slug: 'the-old-mill',
    logoId: null,
    coverImageId: null,
    description: null,
    cuisineType: null,
    averageRating,
    priceLevel: null,
    status: RestaurantStatus.Active,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  });
}

describe('GetReviewsSummaryUseCase', () => {
  function build(restaurant: Restaurant | null, activeReviewCount = 17) {
    const analyticsQueryPort: jest.Mocked<AnalyticsQueryPort> = {
      getReservationSummary: jest.fn(),
      getReservationTrends: jest.fn(),
      getPeakHours: jest.fn(),
      getCustomerInsights: jest.fn(),
      getWaitlistCounts: jest.fn(),
      getReviewsSummary: jest.fn().mockResolvedValue({ activeReviewCount }),
    };
    const restaurantRepository = {
      findById: jest.fn().mockResolvedValue(restaurant),
    } as unknown as jest.Mocked<RestaurantRepository>;
    const clock: ClockPort = { now: () => NOW };

    const useCase = new GetReviewsSummaryUseCase(analyticsQueryPort, restaurantRepository, clock);
    return { useCase, analyticsQueryPort, restaurantRepository };
  }

  it('delegates to AnalyticsQueryPort with the resolved restaurantId and shapes the result from Restaurant.averageRating', async () => {
    const { useCase, analyticsQueryPort } = build(buildRestaurant(4.5));

    const result = await useCase.execute({ actor: OWNER_ACTOR, restaurantId: RESTAURANT_ID });

    expect(analyticsQueryPort.getReviewsSummary).toHaveBeenCalledWith(RESTAURANT_ID);
    expect(result).toEqual({
      activeReviewCount: 17,
      averageRating: 4.5,
      generatedAt: NOW.toISOString(),
    });
  });

  it('returns a null averageRating when the restaurant has none yet', async () => {
    const { useCase } = build(buildRestaurant(null));

    const result = await useCase.execute({ actor: OWNER_ACTOR, restaurantId: RESTAURANT_ID });

    expect(result.averageRating).toBeNull();
  });

  it('throws RestaurantNotFoundException for a cross-organization restaurantId (IDOR-safe 404)', async () => {
    const { useCase, restaurantRepository } = build(null);

    await expect(
      useCase.execute({ actor: OWNER_ACTOR, restaurantId: OTHER_RESTAURANT_ID }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    expect(restaurantRepository.findById).toHaveBeenCalled();
  });

  it('throws PermissionDeniedException for an OrganizationMember without Owner/Admin role', async () => {
    const { useCase } = build(buildRestaurant());

    await expect(
      useCase.execute({ actor: STAFF_ACTOR, restaurantId: RESTAURANT_ID }),
    ).rejects.toBeInstanceOf(PermissionDeniedException);
  });

  it('throws PermissionDeniedException for an Employee missing reports:view', async () => {
    const { useCase } = build(buildRestaurant());
    const employeeActor = {
      actorType: AccessTokenActorType.Employee as const,
      userId: 'user-3',
      sessionId: 'session-3',
      sessionVersion: 1,
      tokenFamilyId: 'family-3',
      employeeId: 'employee-1',
      organizationId: 'org-1',
      restaurantId: RESTAURANT_ID,
      branchIds: [],
      permissions: [] as string[],
      permissionsVersion: 1,
    };

    await expect(
      useCase.execute({ actor: employeeActor, restaurantId: RESTAURANT_ID }),
    ).rejects.toBeInstanceOf(PermissionDeniedException);
  });

  it('allows an Employee holding reports:view for their own restaurant', async () => {
    const { useCase } = build(buildRestaurant());
    const employeeActor = {
      actorType: AccessTokenActorType.Employee as const,
      userId: 'user-4',
      sessionId: 'session-4',
      sessionVersion: 1,
      tokenFamilyId: 'family-4',
      employeeId: 'employee-2',
      organizationId: 'org-1',
      restaurantId: RESTAURANT_ID,
      branchIds: [],
      permissions: [REPORTS_VIEW_PERMISSION],
      permissionsVersion: 1,
    };

    const result = await useCase.execute({ actor: employeeActor, restaurantId: RESTAURANT_ID });

    expect(result.activeReviewCount).toBe(17);
  });
});
