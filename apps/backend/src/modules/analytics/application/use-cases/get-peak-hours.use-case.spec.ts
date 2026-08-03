import { GetPeakHoursUseCase } from './get-peak-hours.use-case';
import { AnalyticsQueryPort } from '../ports/analytics-query.port';
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

describe('GetPeakHoursUseCase', () => {
  function build(counts: Map<number, number>) {
    const analyticsQueryPort: jest.Mocked<AnalyticsQueryPort> = {
      getReservationSummary: jest.fn(),
      getReservationTrends: jest.fn(),
      getPeakHours: jest.fn().mockResolvedValue(counts),
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

    const useCase = new GetPeakHoursUseCase(
      analyticsQueryPort,
      resolveScope,
      resolveDateRange,
      clock,
    );
    return { useCase, analyticsQueryPort, resolveScope };
  }

  it('delegates to AnalyticsQueryPort with the resolved branch scope and zero-fills all 24 hours', async () => {
    const counts = new Map<number, number>([
      [12, 7],
      [19, 3],
    ]);
    const { useCase, analyticsQueryPort, resolveScope } = build(counts);

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
    expect(analyticsQueryPort.getPeakHours).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 'branch-1', timezone: 'UTC' }),
    );
    expect(result.peakHours).toHaveLength(24);
    expect(result.peakHours[12]).toBe(7);
    expect(result.peakHours[19]).toBe(3);
    expect(result.peakHours[0]).toBe(0);
    expect(result.generatedAt).toBe(NOW.toISOString());
  });

  it('propagates RestaurantNotFoundException for a cross-organization restaurantId (IDOR-safe 404)', async () => {
    const { useCase, resolveScope } = build(new Map());
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
    const { useCase, resolveScope } = build(new Map());
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
