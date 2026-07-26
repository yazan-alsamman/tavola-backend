import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import { AppModule } from '../../src/app.module';
import { createGlobalValidationPipe } from '../../src/common/pipes/validation-pipe.factory';
import { RedisIoAdapter } from '../../src/infrastructure/websocket/redis-io.adapter';
import { TokenService } from '../../src/modules/authentication/domain/services/token-service.port';
import { TOKEN_SERVICE } from '../../src/modules/authentication/domain/tokens/authentication.tokens';
import { AccessTokenActorType } from '../../src/modules/authentication/domain/services/access-token-claims';

export const REALTIME_TEST_PREFIX = 'realtime-e2e-';
/** `ReservationGuest` has no tenant-scoped column to filter cleanup by
 * (unlike every other row this fixture creates) - a fixed, distinctive
 * `fullName` is the cleanup key instead. */
export const REALTIME_TEST_GUEST_NAME = 'Realtime E2E Guest';

/**
 * Boots a REAL, listening `INestApplication` - unlike `createTestApp`
 * (`test/helpers/test-app.factory.ts`), which only calls `app.init()` for
 * supertest's in-process request injection. A real `socket.io-client`
 * handshake needs an actual bound TCP port, and the Redis Socket.IO adapter
 * wired exactly as `main.ts` does (Phase 8 §22/§28/§29 - "real Redis...
 * real socket.io-client").
 */
export async function createRealtimeTestApp(): Promise<{ app: INestApplication; url: string }> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication({ bufferLogs: true });
  app.useGlobalPipes(createGlobalValidationPipe());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.disable('x-powered-by');
  expressApp.use(json({ limit: '10mb' }));
  expressApp.use(urlencoded({ extended: true, limit: '10mb' }));

  const redisIoAdapter = new RedisIoAdapter(app);
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const socketAdapterDbIndex = parseInt(process.env.REDIS_SOCKET_ADAPTER_DB_INDEX ?? '2', 10);
  redisIoAdapter.connectToRedis(redisUrl, socketAdapterDbIndex);
  app.useWebSocketAdapter(redisIoAdapter);

  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address !== null ? address.port : address;
  const url = `http://127.0.0.1:${port}`;

  return { app, url };
}

export function signAccessTokenFor(
  app: INestApplication,
  claims:
    | { actorType: AccessTokenActorType.User; sub: string; sessionId?: string }
    | {
        actorType: AccessTokenActorType.Employee;
        sub: string;
        employeeId: string;
        organizationId: string;
        restaurantId: string;
        branchIds: string[];
        permissions: string[];
        sessionId?: string;
      }
    | {
        actorType: AccessTokenActorType.OrganizationMember;
        sub: string;
        organizationId: string;
        orgRole: string;
        sessionId?: string;
      },
): string {
  const tokenService = app.get<TokenService>(TOKEN_SERVICE);
  const base = {
    sub: claims.sub,
    sessionId: claims.sessionId ?? randomUUID(),
    sessionVersion: 1,
    tokenFamilyId: randomUUID(),
  };

  switch (claims.actorType) {
    case AccessTokenActorType.User:
      return tokenService.signAccessToken({ ...base, actorType: AccessTokenActorType.User });
    case AccessTokenActorType.Employee:
      return tokenService.signAccessToken({
        ...base,
        actorType: AccessTokenActorType.Employee,
        employeeId: claims.employeeId,
        organizationId: claims.organizationId,
        restaurantId: claims.restaurantId,
        branchIds: claims.branchIds,
        permissions: claims.permissions,
        permissionsVersion: 1,
      });
    case AccessTokenActorType.OrganizationMember:
      return tokenService.signAccessToken({
        ...base,
        actorType: AccessTokenActorType.OrganizationMember,
        organizationId: claims.organizationId,
        orgRole: claims.orgRole,
        permissionsVersion: 1,
      });
  }
}

export interface RealtimeWorld {
  organizationId: string;
  otherOrganizationId: string;
  restaurantId: string;
  branchId: string;
  otherBranchId: string;
  floorPlanId: string;
  tableId: string;
  employeeUserId: string;
  otherBranchEmployeeUserId: string;
  orgMemberUserId: string;
  otherOrgMemberUserId: string;
  customerUserId: string;
  otherCustomerUserId: string;
}

async function seedActiveUser(prisma: PrismaClient, label: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      firstName: label,
      lastName: 'Fixture',
      email: `${REALTIME_TEST_PREFIX}${label}-${randomUUID()}@example.com`,
      passwordHash: 'argon2id$fake$not-used-by-this-spec',
      language: 'en',
      status: 'Active',
      emailVerified: true,
    },
  });
  return user.id;
}

/**
 * Seeds the minimal real-DB world Phase 8's authorization matrix needs:
 * two Organizations (cross-org isolation), a Restaurant/Branch/FloorPlan/
 * Table in the first, a second Branch in the same restaurant (cross-branch
 * isolation), and one `User` row per actor this suite signs a JWT for -
 * `Employee`/`OrganizationMember` claims (restaurantId/branchIds/
 * organizationId/permissions) are embedded directly in the signed JWT
 * (PermissionsGuard/WsAuthenticationService never re-resolve them from the
 * database - see `permissions.guard.ts`'s own doc comment), so no `Employee`/
 * `EmployeeBranchAssignment`/`Role`/`Permission` rows are required for this
 * suite's purposes; only a real, Active `User` row per JWT `sub` is (
 * `SessionVersionGuard`/`WsAuthenticationService` both look up `User`).
 */
export async function seedRealtimeWorld(prisma: PrismaClient): Promise<RealtimeWorld> {
  const org = await prisma.organization.create({
    data: {
      name: 'Realtime E2E Org',
      slug: `${REALTIME_TEST_PREFIX}org-${randomUUID()}`,
      billingEmail: `${REALTIME_TEST_PREFIX}${randomUUID()}@example.com`,
    },
  });
  const otherOrg = await prisma.organization.create({
    data: {
      name: 'Realtime E2E Other Org',
      slug: `${REALTIME_TEST_PREFIX}otherorg-${randomUUID()}`,
      billingEmail: `${REALTIME_TEST_PREFIX}${randomUUID()}@example.com`,
    },
  });
  const restaurant = await prisma.restaurant.create({
    data: {
      organizationId: org.id,
      name: 'Realtime Bistro',
      slug: `${REALTIME_TEST_PREFIX}${randomUUID()}`,
      status: 'Active',
    },
  });
  const branch = await prisma.branch.create({
    data: {
      restaurantId: restaurant.id,
      city: 'Damascus',
      address: '1 Realtime St',
      countryCode: 'SY',
      timezone: 'Asia/Damascus',
    },
  });
  const otherBranch = await prisma.branch.create({
    data: {
      restaurantId: restaurant.id,
      city: 'Aleppo',
      address: '2 Realtime St',
      countryCode: 'SY',
      timezone: 'Asia/Damascus',
    },
  });
  const floorPlan = await prisma.floorPlan.create({
    data: { branchId: branch.id, name: 'Main Floor', isActive: true },
  });
  const table = await prisma.table.create({
    data: { branchId: branch.id, floorPlanId: floorPlan.id, tableNumber: 'T1', capacity: 4 },
  });

  const employeeUserId = await seedActiveUser(prisma, 'employee');
  const otherBranchEmployeeUserId = await seedActiveUser(prisma, 'other-branch-employee');
  const orgMemberUserId = await seedActiveUser(prisma, 'org-member');
  const otherOrgMemberUserId = await seedActiveUser(prisma, 'other-org-member');
  const customerUserId = await seedActiveUser(prisma, 'customer');
  const otherCustomerUserId = await seedActiveUser(prisma, 'other-customer');

  return {
    organizationId: org.id,
    otherOrganizationId: otherOrg.id,
    restaurantId: restaurant.id,
    branchId: branch.id,
    otherBranchId: otherBranch.id,
    floorPlanId: floorPlan.id,
    tableId: table.id,
    employeeUserId,
    otherBranchEmployeeUserId,
    orgMemberUserId,
    otherOrgMemberUserId,
    customerUserId,
    otherCustomerUserId,
  };
}

/**
 * `tableId` defaults to `world.tableId` but accepts an override - each
 * reservation that will actually be Approved in a test must use its own
 * Table (`Table.reserve()` requires `Available`, and a Table already
 * `Reserved` by an earlier test's Approve in the same shared `world` would
 * make a second Approve on that same table fail with
 * `InvalidTableStatusTransitionException`, unrelated to whatever the test
 * itself is trying to prove).
 */
export async function seedPendingReservation(
  prisma: PrismaClient,
  world: Pick<RealtimeWorld, 'restaurantId' | 'branchId' | 'tableId' | 'customerUserId'>,
  overrides: Partial<{ startTime: Date; endTime: Date; tableId: string }> = {},
): Promise<string> {
  const startTime = overrides.startTime ?? new Date('2026-12-01T18:00:00.000Z');
  const endTime = overrides.endTime ?? new Date('2026-12-01T19:30:00.000Z');
  const reservation = await prisma.reservation.create({
    data: {
      userId: world.customerUserId,
      restaurantId: world.restaurantId,
      branchId: world.branchId,
      tableId: overrides.tableId ?? world.tableId,
      reservationDate: new Date('2026-12-01T00:00:00.000Z'),
      reservationStartTime: startTime,
      reservationEndTime: endTime,
      guests: 2,
      status: 'Pending',
      source: 'Online',
      createdBy: world.customerUserId,
    },
  });
  return reservation.id;
}

/** Seeds an additional, independent Table on the world's own Branch/FloorPlan -
 * for tests (or multiple Approve flows within one test file) that must not
 * share a Table with another already-Approved reservation. */
export async function seedAdditionalTable(
  prisma: PrismaClient,
  world: Pick<RealtimeWorld, 'branchId' | 'floorPlanId'>,
): Promise<string> {
  const table = await prisma.table.create({
    data: {
      branchId: world.branchId,
      floorPlanId: world.floorPlanId,
      tableNumber: `T-${randomUUID().slice(0, 8)}`,
      capacity: 4,
    },
  });
  return table.id;
}

/** Seeds a second, independent FloorPlan on the world's own Branch - needed
 * by the Move Table flow, which requires a real target FloorPlan distinct
 * from the Table's current one. `isActive: false` - Phase 6.1 decision #5's
 * partial unique index (`floor_plans_branch_id_active_key`) allows at most
 * one ACTIVE FloorPlan per Branch, and the world's own seeded "Main Floor"
 * already holds that slot; `MoveTableUseCase`'s target-FloorPlan lookup
 * (`findByIdAndBranchId`) only requires the target to exist, belong to this
 * Branch, and not be soft-deleted - never that it be active. */
export async function seedAdditionalFloorPlan(
  prisma: PrismaClient,
  world: Pick<RealtimeWorld, 'branchId'>,
): Promise<string> {
  const floorPlan = await prisma.floorPlan.create({
    data: {
      branchId: world.branchId,
      name: `Second Floor ${randomUUID().slice(0, 8)}`,
      isActive: false,
    },
  });
  return floorPlan.id;
}

/**
 * Seeds a reservation directly in `Approved` status (bypassing the Approve
 * REST call, exactly like `seedPendingReservation` bypasses Create) with its
 * Table's `status` set to `Reserved` to match the real post-Approve
 * invariant - needed by the Cancel/Reschedule/NoShow/TableReady E2E flows,
 * each of which requires a real Approved precondition before its own
 * dedicated REST mutation (the thing actually under test) runs. `startTime`
 * defaults into the future; NoShow needs a past `startTime` (see that test's
 * own override), which `Reservation.markNoShow()` requires.
 */
export async function seedApprovedReservation(
  prisma: PrismaClient,
  world: Pick<
    RealtimeWorld,
    'restaurantId' | 'branchId' | 'tableId' | 'customerUserId' | 'employeeUserId'
  >,
  overrides: Partial<{ startTime: Date; endTime: Date; tableId: string }> = {},
): Promise<string> {
  const startTime = overrides.startTime ?? new Date('2026-12-01T18:00:00.000Z');
  const endTime = overrides.endTime ?? new Date('2026-12-01T19:30:00.000Z');
  const tableId = overrides.tableId ?? world.tableId;
  const reservation = await prisma.reservation.create({
    data: {
      userId: world.customerUserId,
      restaurantId: world.restaurantId,
      branchId: world.branchId,
      tableId,
      reservationDate: new Date(
        Date.UTC(startTime.getUTCFullYear(), startTime.getUTCMonth(), startTime.getUTCDate()),
      ),
      reservationStartTime: startTime,
      reservationEndTime: endTime,
      guests: 2,
      status: 'Approved',
      source: 'Online',
      createdBy: world.customerUserId,
      approvedBy: world.employeeUserId,
      approvedAt: new Date(),
    },
  });
  await prisma.table.update({ where: { id: tableId }, data: { status: 'Reserved' } });
  return reservation.id;
}

/**
 * Seeds a `Waiting` waitlist entry directly (mirroring
 * `seedPendingReservation`'s bypass pattern) - needed by the
 * WaitlistEntryPromoted E2E flow. `preferredDate`/`preferredTimeFrom` follow
 * the same `Date.UTC(1970, 0, 1, hh, mm, 0)` time-of-day convention used by
 * `test/waitlist/*.integration-spec.ts`; the derived reservation start time
 * (via `WaitlistSlotService`, resolved against the seeded Branch's own
 * `Asia/Damascus` timezone) must land in the future.
 */
export async function seedWaitlistEntry(
  prisma: PrismaClient,
  world: Pick<RealtimeWorld, 'restaurantId' | 'branchId' | 'customerUserId'>,
  overrides: Partial<{
    preferredDate: Date;
    preferredTimeFromHour: number;
    partySize: number;
  }> = {},
): Promise<string> {
  const preferredDate = overrides.preferredDate ?? new Date('2026-12-20T00:00:00.000Z');
  const preferredTimeFrom = new Date(
    Date.UTC(1970, 0, 1, overrides.preferredTimeFromHour ?? 18, 0, 0),
  );
  const entry = await prisma.reservationWaitlistEntry.create({
    data: {
      restaurantId: world.restaurantId,
      branchId: world.branchId,
      userId: world.customerUserId,
      reservationGuestId: null,
      partySize: overrides.partySize ?? 2,
      preferredDate,
      preferredTimeFrom,
      preferredTimeTo: null,
      status: 'Waiting',
      position: 1,
      expiresAt: new Date(preferredDate.getTime() + 86_399_999),
      notes: null,
      createdBy: world.customerUserId,
    },
  });
  return entry.id;
}

export async function cleanupRealtimeWorld(prisma: PrismaClient): Promise<void> {
  await prisma.reservationWaitlistEntry.deleteMany({
    where: { restaurant: { slug: { startsWith: REALTIME_TEST_PREFIX } } },
  });
  await prisma.reservationHistory.deleteMany({
    where: { reservation: { restaurant: { slug: { startsWith: REALTIME_TEST_PREFIX } } } },
  });
  await prisma.reservation.deleteMany({
    where: { restaurant: { slug: { startsWith: REALTIME_TEST_PREFIX } } },
  });
  await prisma.reservationGuest.deleteMany({ where: { fullName: REALTIME_TEST_GUEST_NAME } });
  await prisma.table.deleteMany({
    where: { branch: { restaurant: { slug: { startsWith: REALTIME_TEST_PREFIX } } } },
  });
  await prisma.floorPlan.deleteMany({
    where: { branch: { restaurant: { slug: { startsWith: REALTIME_TEST_PREFIX } } } },
  });
  await prisma.branch.deleteMany({
    where: { restaurant: { slug: { startsWith: REALTIME_TEST_PREFIX } } },
  });
  await prisma.restaurant.deleteMany({ where: { slug: { startsWith: REALTIME_TEST_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: REALTIME_TEST_PREFIX } } });
  await prisma.organization.deleteMany({ where: { slug: { startsWith: REALTIME_TEST_PREFIX } } });
}
