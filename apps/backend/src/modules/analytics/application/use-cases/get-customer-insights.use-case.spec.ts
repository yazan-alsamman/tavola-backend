import { GetCustomerInsightsUseCase } from './get-customer-insights.use-case';
import { AnalyticsQueryPort, CustomerInsightsRawData } from '../ports/analytics-query.port';
import { ResolveAnalyticsScopeService } from '../services/resolve-analytics-scope.service';
import { ResolveAnalyticsDateRangeService } from '../services/resolve-analytics-date-range.service';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { ClockPort } from '@shared/application/ports/clock.port';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';

const NOW = new Date('2026-07-28T12:00:00.000Z');

function buildRaw(overrides: Partial<CustomerInsightsRawData> = {}): CustomerInsightsRawData {
  return {
    uniqueRegisteredCustomers: 40,
    returningRegisteredCustomers: 12,
    guestBackedReservationCount: 8,
    partySizeSum: 100,
    partySizeCount: 25,
    ...overrides,
  };
}

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

describe('GetCustomerInsightsUseCase', () => {
  function build(raw: CustomerInsightsRawData) {
    const analyticsQueryPort: jest.Mocked<AnalyticsQueryPort> = {
      getReservationSummary: jest.fn(),
      getReservationTrends: jest.fn(),
      getPeakHours: jest.fn(),
      getCustomerInsights: jest.fn().mockResolvedValue(raw),
      getWaitlistCounts: jest.fn(),
      getReviewsSummary: jest.fn(),
    };
    const resolveScope = {
      resolveRestaurantScope: jest
        .fn()
        .mockResolvedValue({ restaurantId: 'restaurant-1', branchIds: null }),
      resolveBranchScope: jest.fn(),
      resolveOrganizationScope: jest.fn(),
    } as unknown as jest.Mocked<ResolveAnalyticsScopeService>;
    const resolveDateRange = new ResolveAnalyticsDateRangeService();
    const clock: ClockPort = { now: () => NOW };

    const useCase = new GetCustomerInsightsUseCase(
      analyticsQueryPort,
      resolveScope,
      resolveDateRange,
      clock,
    );
    return { useCase, analyticsQueryPort, resolveScope };
  }

  it('delegates to AnalyticsQueryPort with the resolved restaurant scope and shapes the result', async () => {
    const { useCase, analyticsQueryPort, resolveScope } = build(buildRaw());

    const result = await useCase.execute({
      actor: OWNER_ACTOR,
      restaurantId: 'restaurant-1',
      branchId: 'branch-9',
      range: { range: 'last30d' },
    });

    expect(resolveScope.resolveRestaurantScope).toHaveBeenCalledWith(
      OWNER_ACTOR,
      'restaurant-1',
      'branch-9',
    );
    expect(analyticsQueryPort.getCustomerInsights).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantIds: ['restaurant-1'], branchIds: null }),
    );
    expect(result).toEqual({
      uniqueRegisteredCustomers: 40,
      returningRegisteredCustomers: 12,
      guestBackedReservationCount: 8,
      avgPartySize: 4,
      generatedAt: NOW.toISOString(),
    });
  });

  it('returns null avgPartySize with zero observations', async () => {
    const { useCase } = build(buildRaw({ partySizeSum: 0, partySizeCount: 0 }));

    const result = await useCase.execute({
      actor: OWNER_ACTOR,
      restaurantId: 'restaurant-1',
      range: { range: 'today' },
    });

    expect(result.avgPartySize).toBeNull();
  });

  it('propagates RestaurantNotFoundException for a cross-organization restaurantId (IDOR-safe 404)', async () => {
    const { useCase, resolveScope } = build(buildRaw());
    (resolveScope.resolveRestaurantScope as jest.Mock).mockRejectedValue(
      new RestaurantNotFoundException(),
    );

    await expect(
      useCase.execute({
        actor: OWNER_ACTOR,
        restaurantId: 'other-restaurant',
        range: { range: 'today' },
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('propagates EmployeeBranchNotAssignedException for an Employee outside their assigned branch', async () => {
    const { useCase, resolveScope } = build(buildRaw());
    (resolveScope.resolveRestaurantScope as jest.Mock).mockRejectedValue(
      new EmployeeBranchNotAssignedException(),
    );

    await expect(
      useCase.execute({
        actor: OWNER_ACTOR,
        restaurantId: 'restaurant-1',
        branchId: 'branch-not-assigned',
        range: { range: 'today' },
      }),
    ).rejects.toBeInstanceOf(EmployeeBranchNotAssignedException);
  });
});
