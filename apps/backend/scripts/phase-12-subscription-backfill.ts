/**
 * Phase 12 (Subscriptions, ADR-027 §11, D26) - deterministic, idempotent
 * backfill: every existing Organization without a Subscription receives the
 * default plan (Active, indefinite), a SubscriptionUsage row with the REAL
 * current restaurant count, and every existing Restaurant without a
 * RestaurantUsage row receives one with the REAL current branch/employee
 * counts. Not embedded in the migration (MIGRATION_POLICY.md) - a separate,
 * re-runnable script. Before running against a real environment, verify no
 * existing Organization/Restaurant already exceeds the default plan's
 * limits (see this repository's own audit before running).
 *
 * Usage: DATABASE_URL=... npx tsx scripts/phase-12-subscription-backfill.ts
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();
const DEFAULT_PLAN_SLUG = 'default';

async function main(): Promise<void> {
  const defaultPlan = await prisma.subscriptionPlan.findUnique({
    where: { slug: DEFAULT_PLAN_SLUG },
  });
  if (!defaultPlan) {
    throw new Error(
      `Default SubscriptionPlan (slug="${DEFAULT_PLAN_SLUG}") not found - run "prisma:seed" first.`,
    );
  }

  const now = new Date();

  const organizationsWithoutSubscription = await prisma.organization.findMany({
    where: { subscription: null },
    select: { id: true },
  });

  console.log(
    `Backfilling ${organizationsWithoutSubscription.length} Organization(s) with no Subscription...`,
  );

  for (const org of organizationsWithoutSubscription) {
    const restaurantCount = await prisma.restaurant.count({
      where: { organizationId: org.id, deletedAt: null },
    });

    await prisma.$transaction([
      prisma.subscription.create({
        data: {
          id: randomUUID(),
          organizationId: org.id,
          subscriptionPlanId: defaultPlan.id,
          status: 'Active',
          startsAt: now,
          endsAt: null,
        },
      }),
      prisma.subscriptionUsage.create({
        data: {
          id: randomUUID(),
          organizationId: org.id,
          restaurantCount,
          updatedAt: now,
        },
      }),
    ]);
  }

  const restaurantsWithoutUsage = await prisma.restaurant.findMany({
    where: { usage: null, deletedAt: null },
    select: { id: true },
  });

  console.log(`Backfilling ${restaurantsWithoutUsage.length} Restaurant(s) with no RestaurantUsage...`);

  for (const restaurant of restaurantsWithoutUsage) {
    const [branchCount, employeeCount] = await Promise.all([
      prisma.branch.count({ where: { restaurantId: restaurant.id, deletedAt: null } }),
      prisma.employee.count({ where: { restaurantId: restaurant.id, deletedAt: null } }),
    ]);

    await prisma.restaurantUsage.create({
      data: {
        id: randomUUID(),
        restaurantId: restaurant.id,
        branchCount,
        employeeCount,
        updatedAt: now,
      },
    });
  }

  console.log('Phase 12 subscription backfill complete.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
