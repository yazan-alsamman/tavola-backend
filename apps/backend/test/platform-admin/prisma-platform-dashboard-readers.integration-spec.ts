import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaPlatformAdminRestaurantLookupReader } from '@modules/restaurants/infrastructure/persistence/prisma-platform-admin-restaurant-lookup.reader';
import { PrismaPlatformAdminOrganizationStatsReader } from '@modules/organizations/infrastructure/persistence/prisma-platform-admin-organization-stats.reader';
import { PrismaPlatformAdminSubscriptionStatsReader } from '@modules/subscriptions/infrastructure/persistence/prisma-platform-admin-subscription-stats.reader';
import { PrismaPlatformAdminNotificationStatsReader } from '@modules/notifications/infrastructure/persistence/prisma-platform-admin-notification-stats.reader';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'dash_stats_int_';

/**
 * Phase 19 — Platform Dashboard composition endpoint. These four readers
 * (ADR-035 Pattern 2, platform-wide counts — the fourth, Notification, added
 * Phase 19.6) intentionally have no filter
 * parameter - the entire point is a platform-wide total. Against a shared
 * dev database that may already contain other rows, exact-value assertions
 * would be wrong; every test here instead asserts the DELTA the seeded rows
 * produce (baseline-before vs. after), which is correct regardless of what
 * else exists in the database.
 */
describe('Platform Dashboard Pattern-2 readers (integration, real Postgres)', () => {
  let dbAvailable = false;
  let restaurantReader: PrismaPlatformAdminRestaurantLookupReader;
  let organizationReader: PrismaPlatformAdminOrganizationStatsReader;
  let subscriptionReader: PrismaPlatformAdminSubscriptionStatsReader;
  let notificationReader: PrismaPlatformAdminNotificationStatsReader;
  let subscriptionPlanId: string;

  const createdOrganizationIds: string[] = [];
  const createdRestaurantIds: string[] = [];
  const createdSubscriptionIds: string[] = [];
  const createdNotificationIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaPlatformAdminRestaurantLookupReader,
      PrismaPlatformAdminOrganizationStatsReader,
      PrismaPlatformAdminSubscriptionStatsReader,
      PrismaPlatformAdminNotificationStatsReader,
    ]);
    restaurantReader = moduleRef.get(PrismaPlatformAdminRestaurantLookupReader);
    organizationReader = moduleRef.get(PrismaPlatformAdminOrganizationStatsReader);
    subscriptionReader = moduleRef.get(PrismaPlatformAdminSubscriptionStatsReader);
    notificationReader = moduleRef.get(PrismaPlatformAdminNotificationStatsReader);

    const existingPlan = await rawPrisma.subscriptionPlan.findFirst({
      where: { archivedAt: null },
    });
    if (existingPlan) {
      subscriptionPlanId = existingPlan.id;
    } else {
      const plan = await rawPrisma.subscriptionPlan.create({
        data: {
          id: randomUUID(),
          name: `${TEST_PREFIX}plan_${randomUUID()}`,
          slug: `${TEST_PREFIX}plan-${randomUUID()}`,
          maxRestaurants: 1,
          maxBranchesPerRestaurant: 1,
          maxEmployeesPerRestaurant: 1,
        },
      });
      subscriptionPlanId = plan.id;
    }
  });

  afterAll(async () => {
    if (dbAvailable) {
      await rawPrisma.notification.deleteMany({ where: { id: { in: createdNotificationIds } } });
      await rawPrisma.subscription.deleteMany({ where: { id: { in: createdSubscriptionIds } } });
      await rawPrisma.restaurant.deleteMany({ where: { id: { in: createdRestaurantIds } } });
      await rawPrisma.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
      await rawPrisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await rawPrisma.$disconnect();
    }
  });

  async function seedOrganization(
    overrides: {
      status?: 'Active' | 'Suspended' | 'Closed';
      deletedAt?: Date | null;
    } = {},
  ): Promise<string> {
    const id = randomUUID();
    await rawPrisma.organization.create({
      data: {
        id,
        name: `${TEST_PREFIX}org_${id}`,
        slug: `${TEST_PREFIX}org-${id}`,
        status: overrides.status ?? 'Active',
        billingEmail: `${TEST_PREFIX}${id}@example.test`,
        deletedAt: overrides.deletedAt ?? null,
      },
    });
    createdOrganizationIds.push(id);
    return id;
  }

  async function seedRestaurant(
    organizationId: string,
    overrides: { status?: 'Active' | 'Suspended'; deletedAt?: Date | null } = {},
  ): Promise<string> {
    const id = randomUUID();
    await rawPrisma.restaurant.create({
      data: {
        id,
        organizationId,
        name: `${TEST_PREFIX}rst_${id}`,
        slug: `${TEST_PREFIX}rst-${id}`,
        status: overrides.status ?? 'Active',
        deletedAt: overrides.deletedAt ?? null,
      },
    });
    createdRestaurantIds.push(id);
    return id;
  }

  async function seedSubscription(
    organizationId: string,
    status: 'Active' | 'Suspended' | 'Cancelled' | 'Expired',
  ): Promise<string> {
    const id = randomUUID();
    await rawPrisma.subscription.create({
      data: {
        id,
        organizationId,
        subscriptionPlanId,
        status,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    createdSubscriptionIds.push(id);
    return id;
  }

  async function seedNotification(
    pushStatus: 'NotAttempted' | 'Queued' | 'Accepted' | 'Failed',
  ): Promise<string> {
    const userId = randomUUID();
    await rawPrisma.user.create({
      data: {
        id: userId,
        firstName: 'Notif',
        lastName: 'Fixture',
        email: `${TEST_PREFIX}user-${userId}@example.test`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    createdUserIds.push(userId);

    const id = randomUUID();
    await rawPrisma.notification.create({
      data: {
        id,
        userId,
        type: `${TEST_PREFIX}type`,
        title: 'Test notification',
        body: 'Test body',
        pushStatus,
      },
    });
    createdNotificationIds.push(id);
    return id;
  }

  describe('PrismaPlatformAdminRestaurantLookupReader.countByStatus', () => {
    it('reflects newly-seeded active/suspended/deleted Restaurants as a delta', async () => {
      if (!dbAvailable) return;
      const before = await restaurantReader.countByStatus();

      const organizationId = await seedOrganization();
      await seedRestaurant(organizationId, { status: 'Active' });
      await seedRestaurant(organizationId, { status: 'Active' });
      await seedRestaurant(organizationId, { status: 'Suspended' });
      await seedRestaurant(organizationId, {
        status: 'Active',
        deletedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const after = await restaurantReader.countByStatus();

      expect(after.active - before.active).toBe(2);
      expect(after.suspended - before.suspended).toBe(1);
      expect(after.deleted - before.deleted).toBe(1);
      // total excludes soft-deleted rows (2 active + 1 suspended = 3), not 4
      expect(after.total - before.total).toBe(3);
    });
  });

  describe('PrismaPlatformAdminOrganizationStatsReader.countByStatus', () => {
    it('reflects newly-seeded active/suspended/deleted Organizations as a delta', async () => {
      if (!dbAvailable) return;
      const before = await organizationReader.countByStatus();

      await seedOrganization({ status: 'Active' });
      await seedOrganization({ status: 'Suspended' });
      await seedOrganization({
        status: 'Active',
        deletedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const after = await organizationReader.countByStatus();

      expect(after.active - before.active).toBe(1);
      expect(after.suspended - before.suspended).toBe(1);
      expect(after.deleted - before.deleted).toBe(1);
      expect(after.total - before.total).toBe(2);
    });
  });

  describe('PrismaPlatformAdminSubscriptionStatsReader.countByStatus', () => {
    it('reflects newly-seeded Subscriptions of every status as a delta', async () => {
      if (!dbAvailable) return;
      const before = await subscriptionReader.countByStatus();

      const org1 = await seedOrganization();
      const org2 = await seedOrganization();
      const org3 = await seedOrganization();
      const org4 = await seedOrganization();
      await seedSubscription(org1, 'Active');
      await seedSubscription(org2, 'Suspended');
      await seedSubscription(org3, 'Cancelled');
      await seedSubscription(org4, 'Expired');

      const after = await subscriptionReader.countByStatus();

      expect(after.active - before.active).toBe(1);
      expect(after.suspended - before.suspended).toBe(1);
      expect(after.cancelled - before.cancelled).toBe(1);
      expect(after.expired - before.expired).toBe(1);
      expect(after.total - before.total).toBe(4);
    });
  });

  describe('PrismaPlatformAdminNotificationStatsReader.countByPushStatus', () => {
    it('reflects newly-seeded Notifications of every pushStatus as a delta', async () => {
      if (!dbAvailable) return;
      const before = await notificationReader.countByPushStatus();

      await seedNotification('NotAttempted');
      await seedNotification('Queued');
      await seedNotification('Queued');
      await seedNotification('Accepted');
      await seedNotification('Failed');

      const after = await notificationReader.countByPushStatus();

      expect(after.notAttempted - before.notAttempted).toBe(1);
      expect(after.queued - before.queued).toBe(2);
      expect(after.accepted - before.accepted).toBe(1);
      expect(after.failed - before.failed).toBe(1);
      expect(after.total - before.total).toBe(5);
    });
  });
});
