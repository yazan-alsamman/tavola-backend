import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { PrismaSubscriptionRepository } from '@modules/subscriptions/infrastructure/persistence/prisma-subscription.repository';
import { PrismaSubscriptionPlanRepository } from '@modules/subscriptions/infrastructure/persistence/prisma-subscription-plan.repository';
import { PrismaSubscriptionUsageRepository } from '@modules/subscriptions/infrastructure/persistence/prisma-subscription-usage.repository';
import { PrismaRestaurantUsageRepository } from '@modules/restaurants/infrastructure/persistence/prisma-restaurant-usage.repository';
import { SubscriptionPlan } from '@modules/subscriptions/domain/entities/subscription-plan.entity';
import { Subscription } from '@modules/subscriptions/domain/entities/subscription.entity';
import { SubscriptionUsage } from '@modules/subscriptions/domain/entities/subscription-usage.entity';
import { RestaurantUsage } from '@modules/restaurants/domain/entities/restaurant-usage.entity';
import { SubscriptionStatus } from '@modules/subscriptions/domain/enums/subscription.enums';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * Phase 12 (Subscriptions, architecture frozen 2026-07-28, ADR-027;
 * implementation 2026-07-28). Proves the real-Postgres contract behind the
 * frozen architecture: schema constraints, tenant isolation for the two
 * `DIRECT_TENANT_OWNED_MODELS` (`Subscription`, `SubscriptionUsage`), the
 * per-Restaurant grain of `RestaurantUsage`, and - the highest-priority
 * requirement of this phase (D15) - that the atomic conditional-increment
 * concurrency mechanism actually closes the TOCTOU race under REAL
 * concurrent Postgres writers, not just an in-memory simulation.
 */
const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'subscription-repo-';

describe('Subscriptions round-trip and concurrency (integration)', () => {
  let dbAvailable = false;
  let tenantContextService: TenantContextService;
  let subscriptionRepository: PrismaSubscriptionRepository;
  let subscriptionPlanRepository: PrismaSubscriptionPlanRepository;
  let subscriptionUsageRepository: PrismaSubscriptionUsageRepository;
  let restaurantUsageRepository: PrismaRestaurantUsageRepository;
  let orgA: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaSubscriptionRepository,
      PrismaSubscriptionPlanRepository,
      PrismaSubscriptionUsageRepository,
      PrismaRestaurantUsageRepository,
    ]);
    subscriptionRepository = moduleRef.get(PrismaSubscriptionRepository);
    subscriptionPlanRepository = moduleRef.get(PrismaSubscriptionPlanRepository);
    subscriptionUsageRepository = moduleRef.get(PrismaSubscriptionUsageRepository);
    restaurantUsageRepository = moduleRef.get(PrismaRestaurantUsageRepository);
    tenantContextService = moduleRef.get(TenantContextService);

    orgA = await rawPrisma.organization.create({
      data: {
        name: 'Subscription Repo Test Org A',
        slug: `${TEST_PREFIX}org-a-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}a@example.com`,
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await rawPrisma.restaurantUsage.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.subscriptionUsage.deleteMany({
      where: { organization: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.subscription.deleteMany({
      where: { organization: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.subscriptionPlan.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  function asOrg<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
    return tenantContextService.runAsync(
      { organizationId, userId: null, correlationId: `test-${organizationId}` },
      fn,
    );
  }

  async function seedPlan(overrides: {
    slug: string;
    maxRestaurants?: number;
    maxBranchesPerRestaurant?: number;
    maxEmployeesPerRestaurant?: number;
  }): Promise<SubscriptionPlan> {
    const plan = SubscriptionPlan.create({
      id: randomUUID(),
      name: overrides.slug,
      slug: `${TEST_PREFIX}${overrides.slug}`,
      maxRestaurants: overrides.maxRestaurants ?? 100,
      maxBranchesPerRestaurant: overrides.maxBranchesPerRestaurant ?? 100,
      maxEmployeesPerRestaurant: overrides.maxEmployeesPerRestaurant ?? 100,
      now: new Date(),
    });
    await subscriptionPlanRepository.save(plan);
    return plan;
  }

  async function seedRestaurant(organizationId: string): Promise<string> {
    const restaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId,
        name: 'Test Restaurant',
        slug: `${TEST_PREFIX}restaurant-${randomUUID()}`,
        status: 'Active',
      },
    });
    return restaurant.id;
  }

  describe('SubscriptionPlan (platform-global)', () => {
    it('persists and round-trips, findable by slug without any TenantContext bound', async () => {
      if (!dbAvailable) return;
      const plan = await seedPlan({ slug: `plan-${randomUUID()}` });

      const found = await subscriptionPlanRepository.findBySlug(plan.slug);
      expect(found).not.toBeNull();
      expect(found?.maxRestaurants).toBe(100);
    });

    it('enforces nonnegative limits at the database level (CHECK constraint)', async () => {
      if (!dbAvailable) return;
      await expect(
        rawPrisma.subscriptionPlan.create({
          data: {
            name: 'Bad Plan',
            slug: `${TEST_PREFIX}bad-plan-${randomUUID()}`,
            maxRestaurants: -1,
            maxBranchesPerRestaurant: 5,
            maxEmployeesPerRestaurant: 5,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('Subscription + SubscriptionUsage (direct tenant-owned)', () => {
    it('enforces one Subscription per Organization (unique constraint)', async () => {
      if (!dbAvailable) return;
      const plan = await seedPlan({ slug: `plan-${randomUUID()}` });
      const now = new Date();
      const first = Subscription.create({
        id: randomUUID(),
        organizationId: orgA.id,
        subscriptionPlanId: plan.planId.value,
        startsAt: now,
        now,
      });
      await asOrg(orgA.id, () => subscriptionRepository.create(first));

      const second = Subscription.create({
        id: randomUUID(),
        organizationId: orgA.id,
        subscriptionPlanId: plan.planId.value,
        startsAt: now,
        now,
      });
      await expect(asOrg(orgA.id, () => subscriptionRepository.create(second))).rejects.toThrow();
    });

    it('tenant isolation: an Organization with no Subscription never sees a DIFFERENT Organization Subscription/Usage via findByOrganizationId', async () => {
      if (!dbAvailable) return;
      const orgWithSubscription = await rawPrisma.organization.create({
        data: {
          name: 'Subscription Repo Test Org (with sub)',
          slug: `${TEST_PREFIX}org-with-sub-${randomUUID()}`,
          billingEmail: `${TEST_PREFIX}with-sub@example.com`,
        },
      });
      const orgWithoutSubscription = await rawPrisma.organization.create({
        data: {
          name: 'Subscription Repo Test Org (without sub)',
          slug: `${TEST_PREFIX}org-without-sub-${randomUUID()}`,
          billingEmail: `${TEST_PREFIX}without-sub@example.com`,
        },
      });
      const plan = await seedPlan({ slug: `plan-${randomUUID()}` });
      const now = new Date();
      const subscription = Subscription.create({
        id: randomUUID(),
        organizationId: orgWithSubscription.id,
        subscriptionPlanId: plan.planId.value,
        startsAt: now,
        now,
      });
      const usage = SubscriptionUsage.create({
        id: randomUUID(),
        organizationId: orgWithSubscription.id,
        now,
      });
      await asOrg(orgWithSubscription.id, async () => {
        await subscriptionRepository.create(subscription);
        await subscriptionUsageRepository.create(usage);
      });

      const foundAsOther = await asOrg(orgWithoutSubscription.id, () =>
        subscriptionRepository.findByOrganizationId(),
      );
      expect(foundAsOther).toBeNull();
      const usageAsOther = await asOrg(orgWithoutSubscription.id, () =>
        subscriptionUsageRepository.findByOrganizationId(),
      );
      expect(usageAsOther).toBeNull();

      const foundAsOwner = await asOrg(orgWithSubscription.id, () =>
        subscriptionRepository.findByOrganizationId(),
      );
      expect(foundAsOwner?.subscriptionId.value).toBe(subscription.subscriptionId.value);
    });

    it('CAS expiration (expireIfActiveAndDue) is idempotent under concurrent replay', async () => {
      if (!dbAvailable) return;
      const org = await rawPrisma.organization.create({
        data: {
          name: 'Subscription Repo Test Org (CAS expiration)',
          slug: `${TEST_PREFIX}org-cas-${randomUUID()}`,
          billingEmail: `${TEST_PREFIX}cas@example.com`,
        },
      });
      const plan = await seedPlan({ slug: `plan-${randomUUID()}` });
      const now = new Date();
      const endsAt = new Date(now.getTime() - 60_000);
      const subscription = Subscription.create({
        id: randomUUID(),
        organizationId: org.id,
        subscriptionPlanId: plan.planId.value,
        startsAt: now,
        endsAt,
        now,
      });
      await asOrg(org.id, () => subscriptionRepository.create(subscription));

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          subscriptionRepository.expireIfActiveAndDue(subscription.subscriptionId, new Date()),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);

      const stored = await subscriptionRepository.findById(subscription.subscriptionId);
      expect(stored?.status).toBe(SubscriptionStatus.Expired);
    });
  });

  describe('CRITICAL CONCURRENCY: maxRestaurants (Organization-scoped, D15)', () => {
    it('two concurrent increments at limit-1 - exactly one succeeds, final counter == limit, no drift', async () => {
      if (!dbAvailable) return;
      const limit = 5;
      const usage = SubscriptionUsage.create({
        id: randomUUID(),
        organizationId: orgA.id,
        now: new Date(),
      });
      // Reset to a clean per-test Subscription/Usage pair scoped to orgA (orgA reused across tests in this file - drop any prior row first).
      await rawPrisma.subscriptionUsage.deleteMany({ where: { organizationId: orgA.id } });
      await asOrg(orgA.id, async () => {
        await subscriptionUsageRepository.create(usage);
        // Pre-fill to limit - 1.
        for (let i = 0; i < limit - 1; i += 1) {
          await subscriptionUsageRepository.incrementRestaurantCountIfUnderLimit(orgA.id, limit);
        }
      });

      const outcomes = await Promise.all([
        asOrg(orgA.id, () =>
          subscriptionUsageRepository.incrementRestaurantCountIfUnderLimit(orgA.id, limit),
        ),
        asOrg(orgA.id, () =>
          subscriptionUsageRepository.incrementRestaurantCountIfUnderLimit(orgA.id, limit),
        ),
      ]);

      const successes = outcomes.filter(Boolean);
      expect(successes).toHaveLength(1);

      const final = await asOrg(orgA.id, () => subscriptionUsageRepository.findByOrganizationId());
      expect(final?.restaurantCount).toBe(limit);
    });
  });

  describe('CRITICAL CONCURRENCY: maxBranchesPerRestaurant (Restaurant-scoped, D15)', () => {
    it('two concurrent increments at limit-1 for the SAME Restaurant - exactly one succeeds, final counter == limit', async () => {
      if (!dbAvailable) return;
      const limit = 3;
      const restaurantId = await seedRestaurant(orgA.id);
      const usage = RestaurantUsage.create({ id: randomUUID(), restaurantId, now: new Date() });
      await restaurantUsageRepository.create(usage);
      for (let i = 0; i < limit - 1; i += 1) {
        await restaurantUsageRepository.incrementBranchCountIfUnderLimit(
          RestaurantId.create(restaurantId),
          limit,
        );
      }

      const outcomes = await Promise.all([
        restaurantUsageRepository.incrementBranchCountIfUnderLimit(
          RestaurantId.create(restaurantId),
          limit,
        ),
        restaurantUsageRepository.incrementBranchCountIfUnderLimit(
          RestaurantId.create(restaurantId),
          limit,
        ),
      ]);

      expect(outcomes.filter(Boolean)).toHaveLength(1);
      const final = await restaurantUsageRepository.findByRestaurantId(
        RestaurantId.create(restaurantId),
      );
      expect(final?.branchCount).toBe(limit);
    });

    it("separate Restaurants never interfere with each other's branch counter (no cross-restaurant consumption)", async () => {
      if (!dbAvailable) return;
      const limit = 2;
      const restaurantIdX = await seedRestaurant(orgA.id);
      const restaurantIdY = await seedRestaurant(orgA.id);
      await restaurantUsageRepository.create(
        RestaurantUsage.create({ id: randomUUID(), restaurantId: restaurantIdX, now: new Date() }),
      );
      await restaurantUsageRepository.create(
        RestaurantUsage.create({ id: randomUUID(), restaurantId: restaurantIdY, now: new Date() }),
      );

      // Exhaust X's limit entirely.
      await restaurantUsageRepository.incrementBranchCountIfUnderLimit(
        RestaurantId.create(restaurantIdX),
        limit,
      );
      await restaurantUsageRepository.incrementBranchCountIfUnderLimit(
        RestaurantId.create(restaurantIdX),
        limit,
      );
      const xExhausted = await restaurantUsageRepository.incrementBranchCountIfUnderLimit(
        RestaurantId.create(restaurantIdX),
        limit,
      );
      expect(xExhausted).toBe(false);

      // Y must still have its own full quota available - X's exhaustion must not have touched Y's row.
      const yStillAvailable = await restaurantUsageRepository.incrementBranchCountIfUnderLimit(
        RestaurantId.create(restaurantIdY),
        limit,
      );
      expect(yStillAvailable).toBe(true);
      const yUsage = await restaurantUsageRepository.findByRestaurantId(
        RestaurantId.create(restaurantIdY),
      );
      expect(yUsage?.branchCount).toBe(1);
    });
  });

  describe('CRITICAL CONCURRENCY: maxEmployeesPerRestaurant (Restaurant-scoped, D15)', () => {
    it('two concurrent increments at limit-1 for the SAME Restaurant - exactly one succeeds, final counter == limit', async () => {
      if (!dbAvailable) return;
      const limit = 4;
      const restaurantId = await seedRestaurant(orgA.id);
      await restaurantUsageRepository.create(
        RestaurantUsage.create({ id: randomUUID(), restaurantId, now: new Date() }),
      );
      for (let i = 0; i < limit - 1; i += 1) {
        await restaurantUsageRepository.incrementEmployeeCountIfUnderLimit(
          RestaurantId.create(restaurantId),
          limit,
        );
      }

      const outcomes = await Promise.all([
        restaurantUsageRepository.incrementEmployeeCountIfUnderLimit(
          RestaurantId.create(restaurantId),
          limit,
        ),
        restaurantUsageRepository.incrementEmployeeCountIfUnderLimit(
          RestaurantId.create(restaurantId),
          limit,
        ),
      ]);

      expect(outcomes.filter(Boolean)).toHaveLength(1);
      const final = await restaurantUsageRepository.findByRestaurantId(
        RestaurantId.create(restaurantId),
      );
      expect(final?.employeeCount).toBe(limit);
    });
  });

  describe('Decrement never goes negative', () => {
    it('decrementBranchCount is a safe no-op at zero', async () => {
      if (!dbAvailable) return;
      const restaurantId = await seedRestaurant(orgA.id);
      await restaurantUsageRepository.create(
        RestaurantUsage.create({ id: randomUUID(), restaurantId, now: new Date() }),
      );
      await restaurantUsageRepository.decrementBranchCount(RestaurantId.create(restaurantId));
      const usage = await restaurantUsageRepository.findByRestaurantId(
        RestaurantId.create(restaurantId),
      );
      expect(usage?.branchCount).toBe(0);
    });
  });
});
