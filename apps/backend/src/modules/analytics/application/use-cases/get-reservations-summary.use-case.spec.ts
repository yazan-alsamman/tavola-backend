import { GetReservationsSummaryUseCase } from './get-reservations-summary.use-case';
import { AnalyticsQueryPort, ReservationSummaryRawData } from '../ports/analytics-query.port';
import { ResolveAnalyticsScopeService } from '../services/resolve-analytics-scope.service';
import { ResolveAnalyticsDateRangeService } from '../services/resolve-analytics-date-range.service';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { ClockPort } from '@shared/application/ports/clock.port';

const NOW = new Date('2026-07-28T12:00:00.000Z');

function buildRaw(overrides: Partial<ReservationSummaryRawData> = {}): ReservationSummaryRawData {
  return {
    statusCounts: {
      Pending: 0,
      Approved: 0,
      Rejected: 0,
      Cancelled: 5,
      Completed: 20,
      Expired: 0,
      NoShow: 5,
    },
    sourceCounts: { Online: 0, Phone: 0, WalkIn: 0, Staff: 0, WaitlistConversion: 0 },
    cancelledFromApprovedCount: 3,
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

describe('GetReservationsSummaryUseCase', () => {
  function build(raw: ReservationSummaryRawData) {
    const analyticsQueryPort: jest.Mocked<AnalyticsQueryPort> = {
      getReservationSummary: jest.fn().mockResolvedValue(raw),
      getReservationTrends: jest.fn(),
      getPeakHours: jest.fn(),
      getCustomerInsights: jest.fn(),
      getWaitlistCounts: jest.fn(),
      getReviewsSummary: jest.fn(),
    };
    const resolveScope = {
      resolveRestaurantScope: jest
        .fn()
        .mockResolvedValue({ restaurantId: 'restaurant-1', branchIds: null }),
      resolveOrganizationScope: jest.fn().mockResolvedValue({ restaurantIds: ['r1', 'r2'] }),
    } as unknown as ResolveAnalyticsScopeService;
    const resolveDateRange = new ResolveAnalyticsDateRangeService();
    const clock: ClockPort = { now: () => NOW };

    const useCase = new GetReservationsSummaryUseCase(
      analyticsQueryPort,
      resolveScope,
      resolveDateRange,
      clock,
    );
    return { useCase, analyticsQueryPort };
  }

  it('computes the ADR-028 cancellation formula from Cancelled-from-Approved only, not raw Cancelled count', async () => {
    const { useCase } = build(buildRaw());

    const result = await useCase.executeForRestaurant({
      actor: OWNER_ACTOR,
      restaurantId: 'restaurant-1',
      range: { range: 'last30d' },
    });

    // Denominator = cancelledFromApprovedCount(3) + Completed(20) + NoShow(5) = 28
    expect(result.cancellationRate).toBeCloseTo(3 / 28);
    // NOT computed against the raw statusCounts.Cancelled (5) - that would
    // wrongly include Cancelled-from-Pending reservations.
    expect(result.cancellationRate).not.toBeCloseTo(5 / 30);
  });

  it('computes completion rate and no-show rate against Completed+NoShow only', async () => {
    const { useCase } = build(buildRaw());

    const result = await useCase.executeForRestaurant({
      actor: OWNER_ACTOR,
      restaurantId: 'restaurant-1',
      range: { range: 'last30d' },
    });

    expect(result.completionRate).toBeCloseTo(20 / 25);
    expect(result.noShowRate).toBeCloseTo(5 / 25);
  });

  it('returns null rates when the denominator is 0', async () => {
    const { useCase } = build(
      buildRaw({
        statusCounts: {
          Pending: 0,
          Approved: 0,
          Rejected: 0,
          Cancelled: 0,
          Completed: 0,
          Expired: 0,
          NoShow: 0,
        },
        cancelledFromApprovedCount: 0,
      }),
    );

    const result = await useCase.executeForRestaurant({
      actor: OWNER_ACTOR,
      restaurantId: 'restaurant-1',
      range: { range: 'today' },
    });

    expect(result.completionRate).toBeNull();
    expect(result.noShowRate).toBeNull();
    expect(result.cancellationRate).toBeNull();
  });

  it('returns null avgPartySize with zero observations', async () => {
    const { useCase } = build(buildRaw({ partySizeSum: 0, partySizeCount: 0 }));

    const result = await useCase.executeForRestaurant({
      actor: OWNER_ACTOR,
      restaurantId: 'restaurant-1',
      range: { range: 'today' },
    });

    expect(result.avgPartySize).toBeNull();
  });

  it('aggregates across every restaurant in the organization scope', async () => {
    const { useCase, analyticsQueryPort } = build(buildRaw());

    await useCase.executeForOrganization({ actor: OWNER_ACTOR, range: { range: 'today' } });

    expect(analyticsQueryPort.getReservationSummary).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantIds: ['r1', 'r2'], branchIds: null }),
    );
  });

  it('includes a generatedAt timestamp', async () => {
    const { useCase } = build(buildRaw());
    const result = await useCase.executeForRestaurant({
      actor: OWNER_ACTOR,
      restaurantId: 'restaurant-1',
      range: { range: 'today' },
    });
    expect(result.generatedAt).toBe(NOW.toISOString());
  });
});
