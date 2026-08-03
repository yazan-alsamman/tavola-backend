import { GetWaitlistAnalyticsUseCase } from './get-waitlist-analytics.use-case';
import { AnalyticsQueryPort, WaitlistStatusCounts } from '../ports/analytics-query.port';
import { ResolveAnalyticsScopeService } from '../services/resolve-analytics-scope.service';
import { ResolveAnalyticsDateRangeService } from '../services/resolve-analytics-date-range.service';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { ClockPort } from '@shared/application/ports/clock.port';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';

const NOW = new Date('2026-07-28T12:00:00.000Z');

function buildCounts(overrides: Partial<WaitlistStatusCounts> = {}): WaitlistStatusCounts {
  return {
    Waiting: 4,
    Notified: 2,
    Converted: 10,
    Cancelled: 3,
    Expired: 1,
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

describe('GetWaitlistAnalyticsUseCase', () => {
  function build(counts: WaitlistStatusCounts) {
    const analyticsQueryPort: jest.Mocked<AnalyticsQueryPort> = {
      getReservationSummary: jest.fn(),
      getReservationTrends: jest.fn(),
      getPeakHours: jest.fn(),
      getCustomerInsights: jest.fn(),
      getWaitlistCounts: jest.fn().mockResolvedValue(counts),
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

    const useCase = new GetWaitlistAnalyticsUseCase(
      analyticsQueryPort,
      resolveScope,
      resolveDateRange,
      clock,
    );
    return { useCase, analyticsQueryPort, resolveScope };
  }

  it('delegates to AnalyticsQueryPort with the resolved restaurant scope and computes the ADR-028 conversion rate', async () => {
    const { useCase, analyticsQueryPort, resolveScope } = build(buildCounts());

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
    expect(analyticsQueryPort.getWaitlistCounts).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantIds: ['restaurant-1'], branchIds: null }),
    );
    expect(result.waitlistEntries).toEqual(buildCounts());
    // Denominator = Converted(10) + Cancelled(3) + Expired(1) = 14; Waiting/Notified excluded.
    expect(result.waitlistConversionRate).toBeCloseTo(10 / 14);
    expect(result.generatedAt).toBe(NOW.toISOString());
  });

  it('returns a null conversion rate when Converted+Cancelled+Expired is 0', async () => {
    const { useCase } = build(
      buildCounts({ Converted: 0, Cancelled: 0, Expired: 0, Waiting: 5, Notified: 1 }),
    );

    const result = await useCase.execute({
      actor: OWNER_ACTOR,
      restaurantId: 'restaurant-1',
      range: { range: 'today' },
    });

    expect(result.waitlistConversionRate).toBeNull();
  });

  it('propagates RestaurantNotFoundException for a cross-organization restaurantId (IDOR-safe 404)', async () => {
    const { useCase, resolveScope } = build(buildCounts());
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
    const { useCase, resolveScope } = build(buildCounts());
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
