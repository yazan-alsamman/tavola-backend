import { GetReservationsTrendsUseCase } from './get-reservations-trends.use-case';
import { AnalyticsQueryPort, DayBucketCounts } from '../ports/analytics-query.port';
import { ResolveAnalyticsScopeService } from '../services/resolve-analytics-scope.service';
import { ResolveAnalyticsDateRangeService } from '../services/resolve-analytics-date-range.service';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { ClockPort } from '@shared/application/ports/clock.port';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';

const NOW = new Date('2026-07-28T12:00:00.000Z');

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

describe('GetReservationsTrendsUseCase', () => {
  function build(raw: DayBucketCounts) {
    const analyticsQueryPort: jest.Mocked<AnalyticsQueryPort> = {
      getReservationSummary: jest.fn(),
      getReservationTrends: jest.fn().mockResolvedValue(raw),
      getPeakHours: jest.fn(),
      getCustomerInsights: jest.fn(),
      getWaitlistCounts: jest.fn(),
      getReviewsSummary: jest.fn(),
    };
    const resolveScope = {
      resolveRestaurantScope: jest.fn(),
      resolveBranchScope: jest.fn().mockResolvedValue({
        restaurantId: 'restaurant-1',
        branchId: 'branch-1',
        timezone: 'UTC',
      }),
      resolveOrganizationScope: jest.fn(),
    } as unknown as jest.Mocked<ResolveAnalyticsScopeService>;
    const resolveDateRange = new ResolveAnalyticsDateRangeService();
    const clock: ClockPort = { now: () => NOW };

    const useCase = new GetReservationsTrendsUseCase(
      analyticsQueryPort,
      resolveScope,
      resolveDateRange,
      clock,
    );
    return { useCase, analyticsQueryPort, resolveScope };
  }

  it('delegates to AnalyticsQueryPort with the resolved branch scope and zero-fills both day-bucket trends', async () => {
    const raw: DayBucketCounts = {
      serviceDayCounts: new Map([['2026-07-28', 5]]),
      bookingCreatedCounts: new Map([['2026-07-28', 2]]),
    };
    const { useCase, analyticsQueryPort, resolveScope } = build(raw);

    const result = await useCase.execute({
      actor: OWNER_ACTOR,
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      range: { range: 'today' },
    });

    expect(resolveScope.resolveBranchScope).toHaveBeenCalledWith(
      OWNER_ACTOR,
      'restaurant-1',
      'branch-1',
    );
    expect(analyticsQueryPort.getReservationTrends).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 'branch-1', timezone: 'UTC' }),
    );
    // 'today' preset resolved against NOW (2026-07-28T12:00:00Z, UTC branch
    // timezone) is a single-day bucket - exercises real zero-fill boundaries
    // without re-testing zeroFillDayBuckets' own logic (already unit tested).
    expect(result.serviceDayTrend).toEqual([{ date: '2026-07-28', count: 5 }]);
    expect(result.bookingCreatedTrend).toEqual([{ date: '2026-07-28', count: 2 }]);
    expect(result.generatedAt).toBe(NOW.toISOString());
  });

  it('zero-fills days absent from the raw counts', async () => {
    const raw: DayBucketCounts = {
      serviceDayCounts: new Map(),
      bookingCreatedCounts: new Map(),
    };
    const { useCase } = build(raw);

    const result = await useCase.execute({
      actor: OWNER_ACTOR,
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      range: { range: 'today' },
    });

    expect(result.serviceDayTrend).toEqual([{ date: '2026-07-28', count: 0 }]);
    expect(result.bookingCreatedTrend).toEqual([{ date: '2026-07-28', count: 0 }]);
  });

  it('propagates RestaurantNotFoundException for a cross-organization restaurantId (IDOR-safe 404)', async () => {
    const { useCase, resolveScope } = build({
      serviceDayCounts: new Map(),
      bookingCreatedCounts: new Map(),
    });
    (resolveScope.resolveBranchScope as jest.Mock).mockRejectedValue(
      new RestaurantNotFoundException(),
    );

    await expect(
      useCase.execute({
        actor: OWNER_ACTOR,
        restaurantId: 'other-restaurant',
        branchId: 'branch-1',
        range: { range: 'today' },
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('propagates EmployeeBranchNotAssignedException for an Employee outside their assigned branch', async () => {
    const { useCase, resolveScope } = build({
      serviceDayCounts: new Map(),
      bookingCreatedCounts: new Map(),
    });
    (resolveScope.resolveBranchScope as jest.Mock).mockRejectedValue(
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
