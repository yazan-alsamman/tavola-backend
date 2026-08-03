/**
 * Phase 15 (Optimization, ADR-029) - k6 fixture seeder.
 *
 * Creates the minimum real, disclosed (`k6-` prefixed) data k6's Discovery /
 * Reservation-availability / Reservation-creation / Analytics scenarios need:
 * one Owner + Organization + Subscription (mirrors
 * `test/helpers/owner-fixture.ts`'s exact end state, bypassing
 * `ProvisionRestaurantOwnerUseCase` the same way that fixture does), one
 * Restaurant + Branch + FloorPlan + a pool of Available Tables, and a pool of
 * Customer Users (phone+password) for Reservation-creation load. All auth for
 * the actual k6 scenarios still goes through the real
 * `POST /auth/login` / `POST /auth/customer/login` endpoints - this script
 * only seeds the underlying rows, exactly as `owner-fixture.ts` does for the
 * existing e2e suite.
 *
 * Writes `k6-fixtures.json` (restaurantId/branchId/tableIds/credentials) next
 * to this file - every k6 scenario reads it via `open()`. Not a production
 * artifact; `cleanup-k6-fixtures.ts` removes every row this script created
 * and re-verifies row counts, matching this session's Phase 15 audit/
 * benchmark cleanup convention.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as argon2 from 'argon2';
import * as fs from 'fs';
import * as path from 'path';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://tavla:tavla_dev_password@localhost:5433/tavla_dev?schema=public';
const PREFIX = process.env.K6_FIXTURE_PREFIX ?? 'k6-';
const CUSTOMER_COUNT = Number(process.env.K6_CUSTOMER_COUNT ?? '20');
const TABLE_COUNT = Number(process.env.K6_TABLE_COUNT ?? '10');
const PASSWORD = 'K6LoadTest123!';

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

async function hashPassword(): Promise<string> {
  return argon2.hash(PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

async function main() {
  const now = new Date();
  const passwordHash = await hashPassword();

  const ownerId = randomUUID();
  const organizationId = randomUUID();
  await prisma.user.create({
    data: {
      id: ownerId,
      firstName: 'K6',
      lastName: 'Owner',
      email: `${PREFIX}owner-${randomUUID()}@example.com`,
      passwordHash,
      language: 'en',
      status: 'Active',
      emailVerified: true,
    },
  });
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: `${PREFIX}organization`,
      slug: `${PREFIX}organization-${randomUUID()}`,
      billingEmail: `${PREFIX}billing-${randomUUID()}@example.com`,
    },
  });
  await prisma.organizationMember.create({
    data: {
      id: randomUUID(),
      organizationId,
      userId: ownerId,
      role: 'Owner',
      status: 'Active',
      invitedAt: now,
      joinedAt: now,
    },
  });
  const defaultPlan = await prisma.subscriptionPlan.findUnique({ where: { slug: 'default' } });
  if (defaultPlan) {
    await prisma.subscription.create({
      data: {
        id: randomUUID(),
        organizationId,
        subscriptionPlanId: defaultPlan.id,
        status: 'Active',
        startsAt: now,
        endsAt: null,
      },
    });
    await prisma.subscriptionUsage.create({
      data: { id: randomUUID(), organizationId, restaurantCount: 1, updatedAt: now },
    });
  }

  const restaurantId = randomUUID();
  await prisma.restaurant.create({
    data: {
      id: restaurantId,
      organizationId,
      name: `${PREFIX}Discovery Load Restaurant`,
      slug: `${PREFIX}discovery-load-${randomUUID()}`,
      description: 'Phase 15 k6 fixture - safe to delete, prefixed and disclosed.',
      cuisineType: 'Turkish',
      averageRating: 4.2,
      priceLevel: 2,
      status: 'Active',
      createdAt: now,
      updatedAt: now,
    },
  });

  const branchId = randomUUID();
  await prisma.branch.create({
    data: {
      id: branchId,
      restaurantId,
      city: 'Istanbul',
      district: 'Kadikoy',
      address: `${PREFIX}Fixture Address 1`,
      latitude: 41.0,
      longitude: 29.0,
      countryCode: 'TR',
      currency: 'TRY',
      timezone: 'Europe/Istanbul',
      phone: null,
      createdAt: now,
      updatedAt: now,
    },
  });

  const floorPlanId = randomUUID();
  await prisma.floorPlan.create({
    data: {
      id: floorPlanId,
      branchId,
      name: `${PREFIX}Main Floor`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  const tableIds: string[] = [];
  for (let i = 0; i < TABLE_COUNT; i += 1) {
    const tableId = randomUUID();
    tableIds.push(tableId);
    await prisma.table.create({
      data: {
        id: tableId,
        branchId,
        floorPlanId,
        tableNumber: `K6-${i + 1}`,
        capacity: 2 + (i % 4) * 2,
        shape: 'Rectangle',
        indoor: true,
        vip: false,
        smoking: false,
        status: 'Available',
        isMergePrimary: false,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  // Additional background Restaurants so Discovery's search/filter/sort
  // paths have more than one row to work against - modest, real-request
  // scale (not the disclosed 20K synthetic-benchmark scale used for the
  // EXPLAIN-only Pre-Implementation Audit).
  const backgroundCount = Number(process.env.K6_BACKGROUND_RESTAURANT_COUNT ?? '200');
  for (let i = 0; i < backgroundCount; i += 1) {
    await prisma.restaurant.create({
      data: {
        id: randomUUID(),
        organizationId,
        name: `${PREFIX}Background Restaurant ${i}`,
        slug: `${PREFIX}background-${i}-${randomUUID()}`,
        description: null,
        cuisineType: ['Turkish', 'Italian', 'Japanese', 'American'][i % 4],
        averageRating: 1 + (i % 5),
        priceLevel: 1 + (i % 4),
        status: 'Active',
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  const customers: Array<{ userId: string; countryCode: string; phoneNumber: string }> = [];
  for (let i = 0; i < CUSTOMER_COUNT; i += 1) {
    const userId = randomUUID();
    // US area code 202 + the FCC-reserved 555-01xx fictional range (0100-0199)
    // - the only 555 numbers `libphonenumber-js`'s strict `isValid()` check
    // (used by the real customer-login/PhoneNumber.create path) accepts, so
    // the seeded DB row and the real login call normalize to the identical
    // E.164 value. 100 possible numbers comfortably covers CUSTOMER_COUNT.
    const phoneNumber = `2025550${String(100 + i).slice(-3)}`;
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'K6',
        lastName: `Customer${i}`,
        phone: `+1${phoneNumber}`,
        username: `${PREFIX}customer_${i}_${randomUUID().slice(0, 6)}`,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: false,
      },
    });
    customers.push({ userId, countryCode: 'US', phoneNumber });
  }

  const fixtures = {
    prefix: PREFIX,
    password: PASSWORD,
    owner: { userId: ownerId, email: (await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).email },
    organizationId,
    restaurantId,
    branchId,
    floorPlanId,
    tableIds,
    customers,
  };

  const outPath = path.join(__dirname, 'k6-fixtures.json');
  fs.writeFileSync(outPath, JSON.stringify(fixtures, null, 2));
  console.log(`Seeded k6 fixtures -> ${outPath}`);
  console.log(`  organization=${organizationId} restaurant=${restaurantId} branch=${branchId}`);
  console.log(`  tables=${tableIds.length} customers=${customers.length} backgroundRestaurants=${backgroundCount}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
