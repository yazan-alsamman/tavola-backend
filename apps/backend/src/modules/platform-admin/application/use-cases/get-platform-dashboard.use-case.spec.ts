import { GetPlatformDashboardUseCase } from './get-platform-dashboard.use-case';
import { InvalidPlatformDashboardQueryException } from '../../domain/exceptions/invalid-platform-dashboard-query.exception';
import {
  PlatformAdminRestaurantLookupReaderPort,
  RestaurantStatusCounts,
} from '@modules/restaurants/application/ports/platform-admin-restaurant-lookup-reader.port';
import {
  OrganizationStatusCounts,
  PlatformAdminOrganizationStatsReaderPort,
} from '@modules/organizations/application/ports/platform-admin-organization-stats-reader.port';
import {
  PlatformAdminSubscriptionStatsReaderPort,
  SubscriptionStatusCounts,
} from '@modules/subscriptions/application/ports/platform-admin-subscription-stats-reader.port';
import {
  AcquisitionCrossTenantReaderPort,
  RevenueReportRawBucket,
} from '@modules/customer-acquisition/application/ports/acquisition-cross-tenant-reader.port';
import {
  NotificationPushStatusCounts,
  PlatformAdminNotificationStatsReaderPort,
} from '@modules/notifications/application/ports/platform-admin-notification-stats-reader.port';
import { ClockPort } from '@shared/application/ports/clock.port';

const NOW = new Date('2026-08-11T12:00:00.000Z');

/**
 * Deferred/manually-resolved fake readers, used to prove `Promise.all`
 * invokes all five sources concurrently rather than sequentially
 * (master authorization §16 - "provide evidence... via controlled test
 * doubles"): each fake records the call, then only resolves once every
 * other fake has also been called - if the use case awaited them one at a
 * time, the second fake would never observe the first fake having already
 * been invoked, and the test would hang/timeout rather than pass.
 */
function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

class FakeRestaurantReader implements PlatformAdminRestaurantLookupReaderPort {
  called = false;
  constructor(
    private readonly result: RestaurantStatusCounts,
    private readonly onCalled?: () => void,
  ) {}
  async findOrganizationIdByRestaurantId() {
    return null;
  }
  async countByStatus() {
    this.called = true;
    this.onCalled?.();
    return this.result;
  }
  async search() {
    return { items: [], total: 0 };
  }
}

class FakeOrganizationReader implements PlatformAdminOrganizationStatsReaderPort {
  called = false;
  constructor(
    private readonly result: OrganizationStatusCounts,
    private readonly onCalled?: () => void,
  ) {}
  async countByStatus() {
    this.called = true;
    this.onCalled?.();
    return this.result;
  }
  async search() {
    return { items: [], total: 0 };
  }
}

class FakeSubscriptionReader implements PlatformAdminSubscriptionStatsReaderPort {
  called = false;
  constructor(
    private readonly result: SubscriptionStatusCounts,
    private readonly onCalled?: () => void,
  ) {}
  async countByStatus() {
    this.called = true;
    this.onCalled?.();
    return this.result;
  }
}

class FakeAcquisitionReader implements AcquisitionCrossTenantReaderPort {
  called = false;
  constructor(
    private readonly buckets: RevenueReportRawBucket[],
    private readonly onCalled?: () => void,
  ) {}
  async groupByRevenue(
    _params: Parameters<AcquisitionCrossTenantReaderPort['groupByRevenue']>[0],
  ): Promise<RevenueReportRawBucket[]> {
    this.called = true;
    this.onCalled?.();
    return this.buckets;
  }
  async exportAcquisitions() {
    return [];
  }
}

class FakeNotificationReader implements PlatformAdminNotificationStatsReaderPort {
  called = false;
  constructor(
    private readonly result: NotificationPushStatusCounts,
    private readonly onCalled?: () => void,
  ) {}
  async countByPushStatus() {
    this.called = true;
    this.onCalled?.();
    return this.result;
  }
}

class FixedClock implements ClockPort {
  now() {
    return NOW;
  }
}

const RESTAURANT_COUNTS: RestaurantStatusCounts = {
  total: 10,
  active: 8,
  suspended: 1,
  deleted: 1,
};
const ORGANIZATION_COUNTS: OrganizationStatusCounts = {
  total: 5,
  active: 4,
  suspended: 1,
  deleted: 0,
};
const SUBSCRIPTION_COUNTS: SubscriptionStatusCounts = {
  total: 5,
  active: 3,
  suspended: 1,
  cancelled: 1,
  expired: 0,
};
const NOTIFICATION_COUNTS: NotificationPushStatusCounts = {
  total: 7,
  notAttempted: 1,
  queued: 2,
  accepted: 3,
  failed: 1,
};

function buildUseCase(overrides?: {
  restaurantReader?: PlatformAdminRestaurantLookupReaderPort;
  organizationReader?: PlatformAdminOrganizationStatsReaderPort;
  subscriptionReader?: PlatformAdminSubscriptionStatsReaderPort;
  acquisitionReader?: AcquisitionCrossTenantReaderPort;
  notificationReader?: PlatformAdminNotificationStatsReaderPort;
  clock?: ClockPort;
}) {
  return new GetPlatformDashboardUseCase(
    overrides?.restaurantReader ?? new FakeRestaurantReader(RESTAURANT_COUNTS),
    overrides?.organizationReader ?? new FakeOrganizationReader(ORGANIZATION_COUNTS),
    overrides?.subscriptionReader ?? new FakeSubscriptionReader(SUBSCRIPTION_COUNTS),
    overrides?.acquisitionReader ?? new FakeAcquisitionReader([]),
    overrides?.notificationReader ?? new FakeNotificationReader(NOTIFICATION_COUNTS),
    overrides?.clock ?? new FixedClock(),
  );
}

describe('GetPlatformDashboardUseCase', () => {
  it('rejects from >= to', async () => {
    const useCase = buildUseCase();
    await expect(
      useCase.execute({ from: new Date('2026-08-01'), to: new Date('2026-08-01') }),
    ).rejects.toBeInstanceOf(InvalidPlatformDashboardQueryException);
  });

  it('rejects a date range exceeding 366 days', async () => {
    const useCase = buildUseCase();
    await expect(
      useCase.execute({ from: new Date('2020-01-01'), to: new Date('2022-01-01') }),
    ).rejects.toBeInstanceOf(InvalidPlatformDashboardQueryException);
  });

  it('composes and maps all five sections correctly', async () => {
    const acquisitionReader = new FakeAcquisitionReader([
      {
        key: '2026-08-01',
        currency: 'SYP',
        recordedCount: 2,
        recordedTotal: 2000,
        reversedCount: 0,
        reversedTotal: 0,
      },
      {
        key: '2026-08-02',
        currency: 'SYP',
        recordedCount: 1,
        recordedTotal: 1000,
        reversedCount: 1,
        reversedTotal: 1000,
      },
      {
        key: '2026-08-01',
        currency: 'USD',
        recordedCount: 3,
        recordedTotal: 30,
        reversedCount: 0,
        reversedTotal: 0,
      },
    ]);
    const useCase = buildUseCase({ acquisitionReader });

    const from = new Date('2026-08-01');
    const to = new Date('2026-08-03');
    const result = await useCase.execute({ from, to });

    expect(result.generatedAt).toEqual(NOW);
    expect(result.restaurants).toEqual(RESTAURANT_COUNTS);
    expect(result.organizations).toEqual(ORGANIZATION_COUNTS);
    expect(result.subscriptions).toEqual(SUBSCRIPTION_COUNTS);
    expect(result.messaging).toEqual(NOTIFICATION_COUNTS);
    expect(result.acquisition.from).toEqual(from);
    expect(result.acquisition.to).toEqual(to);
    // Buckets summed WITHIN each currency, never merged ACROSS currencies
    // (ADR-033 §17/§22) - two SYP day-buckets collapse into one SYP total;
    // the USD bucket stays separate.
    expect(result.acquisition.currencies).toEqual([
      {
        currency: 'SYP',
        recordedCount: 3,
        recordedTotal: 3000,
        reversedCount: 1,
        reversedTotal: 1000,
      },
      { currency: 'USD', recordedCount: 3, recordedTotal: 30, reversedCount: 0, reversedTotal: 0 },
    ]);
  });

  it('returns an empty currencies array when there is no acquisition data in range', async () => {
    const useCase = buildUseCase({ acquisitionReader: new FakeAcquisitionReader([]) });
    const result = await useCase.execute({
      from: new Date('2026-08-01'),
      to: new Date('2026-08-02'),
    });
    expect(result.acquisition.currencies).toEqual([]);
  });

  it('returns all-zero messaging counts when there are no notifications', async () => {
    const zeroCounts: NotificationPushStatusCounts = {
      total: 0,
      notAttempted: 0,
      queued: 0,
      accepted: 0,
      failed: 0,
    };
    const useCase = buildUseCase({
      notificationReader: new FakeNotificationReader(zeroCounts),
    });
    const result = await useCase.execute({
      from: new Date('2026-08-01'),
      to: new Date('2026-08-02'),
    });
    expect(result.messaging).toEqual(zeroCounts);
  });

  it('invokes all five sources in parallel, not sequentially', async () => {
    const callOrder: string[] = [];
    const restaurantDeferred = createDeferred<void>();
    const organizationDeferred = createDeferred<void>();
    const subscriptionDeferred = createDeferred<void>();
    const acquisitionDeferred = createDeferred<void>();
    const notificationDeferred = createDeferred<void>();

    const restaurantReader = new FakeRestaurantReader(RESTAURANT_COUNTS, () =>
      callOrder.push('restaurant'),
    );
    const organizationReader = new FakeOrganizationReader(ORGANIZATION_COUNTS, () =>
      callOrder.push('organization'),
    );
    const subscriptionReader = new FakeSubscriptionReader(SUBSCRIPTION_COUNTS, () =>
      callOrder.push('subscription'),
    );
    const acquisitionReader = new FakeAcquisitionReader([], () => callOrder.push('acquisition'));
    const notificationReader = new FakeNotificationReader(NOTIFICATION_COUNTS, () =>
      callOrder.push('notification'),
    );

    // Override each fake's resolution to wait until every other fake has
    // already recorded its call - only possible if the use case issued all
    // five calls before awaiting any of them (Promise.all), not one at a
    // time (sequential await).
    const originalRestaurant = restaurantReader.countByStatus.bind(restaurantReader);
    restaurantReader.countByStatus = async () => {
      const result = await originalRestaurant();
      await restaurantDeferred.promise;
      return result;
    };
    const originalOrganization = organizationReader.countByStatus.bind(organizationReader);
    organizationReader.countByStatus = async () => {
      const result = await originalOrganization();
      await organizationDeferred.promise;
      return result;
    };
    const originalSubscription = subscriptionReader.countByStatus.bind(subscriptionReader);
    subscriptionReader.countByStatus = async () => {
      const result = await originalSubscription();
      await subscriptionDeferred.promise;
      return result;
    };
    const originalAcquisition = acquisitionReader.groupByRevenue.bind(acquisitionReader);
    acquisitionReader.groupByRevenue = async (params) => {
      const result = await originalAcquisition(params);
      await acquisitionDeferred.promise;
      return result;
    };
    const originalNotification = notificationReader.countByPushStatus.bind(notificationReader);
    notificationReader.countByPushStatus = async () => {
      const result = await originalNotification();
      await notificationDeferred.promise;
      return result;
    };

    const useCase = buildUseCase({
      restaurantReader,
      organizationReader,
      subscriptionReader,
      acquisitionReader,
      notificationReader,
    });

    const resultPromise = useCase.execute({
      from: new Date('2026-08-01'),
      to: new Date('2026-08-02'),
    });

    // Let microtasks flush so every reader's method has had the chance to
    // run up to its own await point.
    await Promise.resolve();
    await Promise.resolve();

    expect(restaurantReader.called).toBe(true);
    expect(organizationReader.called).toBe(true);
    expect(subscriptionReader.called).toBe(true);
    expect(acquisitionReader.called).toBe(true);
    expect(notificationReader.called).toBe(true);
    expect(callOrder).toHaveLength(5);

    restaurantDeferred.resolve();
    organizationDeferred.resolve();
    subscriptionDeferred.resolve();
    acquisitionDeferred.resolve();
    notificationDeferred.resolve();

    await expect(resultPromise).resolves.toBeDefined();
  });
});
