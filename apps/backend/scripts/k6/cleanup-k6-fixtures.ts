/**
 * Phase 15 (Optimization, ADR-029) - removes every row `seed-k6-fixtures.ts`
 * created (matched by the `k6-fixtures.json` id list plus any Reservations
 * created against the seeded Tables during the k6 run itself), then
 * re-verifies row counts, matching this session's disclosed-fixture
 * cleanup-and-verify convention.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://tavla:tavla_dev_password@localhost:5433/tavla_dev?schema=public';

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

async function main() {
  const fixturesPath = path.join(__dirname, 'k6-fixtures.json');
  if (!fs.existsSync(fixturesPath)) {
    console.log('No k6-fixtures.json found - nothing to clean up.');
    return;
  }
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf-8')) as {
    prefix: string;
    organizationId: string;
    restaurantId: string;
    branchId: string;
    floorPlanId: string;
    tableIds: string[];
    customers: Array<{ userId: string }>;
    owner: { userId: string };
  };

  const tableIdCount = await prisma.table.count({ where: { id: { in: fixtures.tableIds } } });
  console.log(`Removing k6 fixtures (prefix=${fixtures.prefix})...`);

  // Reservations created against the seeded tables during the k6 run.
  const deletedReservationHistory = await prisma.reservationHistory.deleteMany({
    where: { reservation: { tableId: { in: fixtures.tableIds } } },
  });
  const deletedReviews = await prisma.review.deleteMany({
    where: { restaurantId: fixtures.restaurantId },
  });
  const deletedReservations = await prisma.reservation.deleteMany({
    where: { tableId: { in: fixtures.tableIds } },
  });
  const deletedTables = await prisma.table.deleteMany({ where: { id: { in: fixtures.tableIds } } });
  const deletedFloorPlans = await prisma.floorPlan.deleteMany({
    where: { id: fixtures.floorPlanId },
  });
  const deletedBranches = await prisma.branch.deleteMany({ where: { id: fixtures.branchId } });
  const deletedRestaurants = await prisma.restaurant.deleteMany({
    where: { organizationId: fixtures.organizationId },
  });
  const deletedSubscriptionUsage = await prisma.subscriptionUsage.deleteMany({
    where: { organizationId: fixtures.organizationId },
  });
  const deletedSubscriptions = await prisma.subscription.deleteMany({
    where: { organizationId: fixtures.organizationId },
  });
  const deletedOrgMembers = await prisma.organizationMember.deleteMany({
    where: { organizationId: fixtures.organizationId },
  });
  const deletedOrganizations = await prisma.organization.deleteMany({
    where: { id: fixtures.organizationId },
  });
  const customerIds = fixtures.customers.map((c) => c.userId);
  const deletedDeviceSessions = await prisma.deviceSession.deleteMany({
    where: { userId: { in: [...customerIds, fixtures.owner.userId] } },
  });
  const deletedCustomers = await prisma.user.deleteMany({ where: { id: { in: customerIds } } });
  const deletedOwner = await prisma.user.deleteMany({ where: { id: fixtures.owner.userId } });

  console.log('Deleted counts:', {
    reservationHistory: deletedReservationHistory.count,
    reviews: deletedReviews.count,
    reservations: deletedReservations.count,
    tables: deletedTables.count,
    floorPlans: deletedFloorPlans.count,
    branches: deletedBranches.count,
    restaurants: deletedRestaurants.count,
    subscriptionUsage: deletedSubscriptionUsage.count,
    subscriptions: deletedSubscriptions.count,
    organizationMembers: deletedOrgMembers.count,
    organizations: deletedOrganizations.count,
    deviceSessions: deletedDeviceSessions.count,
    customers: deletedCustomers.count,
    owner: deletedOwner.count,
  });

  const remainingRestaurants = await prisma.restaurant.count({
    where: { organizationId: fixtures.organizationId },
  });
  const remainingTables = await prisma.table.count({ where: { id: { in: fixtures.tableIds } } });
  const remainingCustomers = await prisma.user.count({ where: { id: { in: customerIds } } });
  console.log('Post-cleanup verification (all must be 0):', {
    remainingRestaurants,
    remainingTables,
    remainingCustomers,
    seededTableIdCount: tableIdCount,
  });

  fs.unlinkSync(fixturesPath);
  console.log('Removed k6-fixtures.json.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
