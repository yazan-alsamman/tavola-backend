import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { AnonymizeUserAccountUseCase } from '@modules/users/application/use-cases/anonymize-user-account.use-case';

const prisma = new PrismaClient();
const TEST_PREFIX = 'acct_del_e2e_';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 20.X (ADR-014 execution) - end-to-end proof of the Customer Account
 * Deletion feature: request/cancel/export through the real HTTP surface,
 * plus the grace-period-elapsed anonymization path (invoked directly via
 * the DI container, matching this codebase's existing convention for
 * testing BullMQ-scheduled behavior without waiting real days).
 */
describe('Customer Account Deletion (e2e, Phase 20.X)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — account deletion e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.auditLog.deleteMany({ where: { correlationId: { startsWith: TEST_PREFIX } } });
      await prisma.favorite.deleteMany({ where: { user: { email: { startsWith: TEST_PREFIX } } } });
      await prisma.message.deleteMany({
        where: { senderUser: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.conversationParticipant.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.conversation.deleteMany({
        where: { restaurant: { organizationId: { in: await organizationIds() } } },
      });
      await prisma.reservationWaitlistEntry.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.reservation.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.deviceSession.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.table.deleteMany({
        where: { branch: { restaurant: { organizationId: { in: await organizationIds() } } } },
      });
      await prisma.floorPlan.deleteMany({
        where: { branch: { restaurant: { organizationId: { in: await organizationIds() } } } },
      });
      await prisma.branch.deleteMany({
        where: { restaurant: { organizationId: { in: await organizationIds() } } },
      });
      await prisma.restaurant.deleteMany({
        where: { organizationId: { in: await organizationIds() } },
      });
      await prisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function organizationIds(): Promise<string[]> {
    const orgs = await prisma.organization.findMany({
      where: { slug: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    return orgs.map((o) => o.id);
  }

  async function createAndLoginUser(
    suffix: string,
  ): Promise<{ accessToken: string; refreshToken: string; email: string; userId: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Deletion',
        lastName: 'Tester',
        email,
        phone: null,
        passwordHash,
        language: 'en',
        preferredCurrency: null,
        status: UserStatus.Active,
        emailVerified: true,
      },
    });

    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);

    return {
      accessToken: loginResponse.body.data.accessToken as string,
      refreshToken: loginResponse.body.data.refreshToken as string,
      email,
      userId,
    };
  }

  function authed(token: string, method: 'get' | 'post' | 'delete', path: string) {
    return request(app!.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);
  }

  async function seedOrgRestaurantBranchTable(): Promise<{
    organizationId: string;
    restaurantId: string;
    branchId: string;
    tableId: string;
  }> {
    const organization = await prisma.organization.create({
      data: {
        name: `${TEST_PREFIX}org`,
        slug: `${TEST_PREFIX}${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}${randomUUID()}@example.com`,
      },
    });
    const restaurant = await prisma.restaurant.create({
      data: {
        organizationId: organization.id,
        name: `${TEST_PREFIX}restaurant`,
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: 'Active',
      },
    });
    const branch = await prisma.branch.create({
      data: {
        restaurantId: restaurant.id,
        city: 'Damascus',
        address: '123 Main St',
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
    return {
      organizationId: organization.id,
      restaurantId: restaurant.id,
      branchId: branch.id,
      tableId: table.id,
    };
  }

  // -------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------

  it('requests deletion, revokes every session, and schedules anonymization', async () => {
    if (!dbAvailable || !app) return;
    const user = await createAndLoginUser('happy');
    const correlationId = `${TEST_PREFIX}corr-${uniqueId()}`;

    const response = await authed(user.accessToken, 'delete', '/api/v1/users/me')
      .set('x-correlation-id', correlationId)
      .send({ password: PASSWORD })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(new Date(response.body.data.scheduledAnonymizationAt).getTime()).toBeGreaterThan(
      Date.now(),
    );

    const row = await prisma.user.findUnique({ where: { id: user.userId } });
    expect(row?.status).toBe('Active');
    expect(row?.deletionRequestedAt).not.toBeNull();
    expect(row?.scheduledAnonymizationAt).not.toBeNull();
    expect(row?.sessionVersion).toBe(2);

    const sessions = await prisma.deviceSession.findMany({ where: { userId: user.userId } });
    expect(sessions.length).toBeGreaterThan(0);
    for (const session of sessions) {
      expect(session.revokedAt).not.toBeNull();
      expect(session.revokedReason).toBe('account_deletion');
    }
    const families = await prisma.tokenFamily.findMany({ where: { userId: user.userId } });
    for (const family of families) {
      expect(family.revokedAt).not.toBeNull();
    }

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'auth.account_deletion.requested', targetId: user.userId },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.actorType).toBe('User');
  });

  // -------------------------------------------------------------------
  // Security tests
  // -------------------------------------------------------------------

  it('rejects an incorrect password (401) and leaves the account untouched', async () => {
    if (!dbAvailable || !app) return;
    const user = await createAndLoginUser('wrong-pw');

    await authed(user.accessToken, 'delete', '/api/v1/users/me')
      .send({ password: 'TotallyWrongPassword1!' })
      .expect(401);

    const row = await prisma.user.findUnique({ where: { id: user.userId } });
    expect(row?.deletionRequestedAt).toBeNull();
  });

  it('rejects a missing/invalid access token (401)', async () => {
    if (!dbAvailable || !app) return;

    await request(app.getHttpServer())
      .delete('/api/v1/users/me')
      .send({ password: PASSWORD })
      .expect(401);
  });

  it('the access token is rejected on the very next request after deletion is requested (sessionVersion bump), before natural expiry', async () => {
    if (!dbAvailable || !app) return;
    const user = await createAndLoginUser('immediate-logout');
    await authed(user.accessToken, 'delete', '/api/v1/users/me')
      .send({ password: PASSWORD })
      .expect(200);

    await authed(user.accessToken, 'get', '/api/v1/users/me').expect(401);
  });

  it('cross-user isolation: deletion always targets the caller only, never a client-supplied id (no such id is even accepted)', async () => {
    if (!dbAvailable || !app) return;
    const userA = await createAndLoginUser('cross-a');
    const userB = await createAndLoginUser('cross-b');

    await authed(userA.accessToken, 'delete', '/api/v1/users/me')
      .send({ password: PASSWORD })
      .expect(200);

    const rowB = await prisma.user.findUnique({ where: { id: userB.userId } });
    expect(rowB?.deletionRequestedAt).toBeNull();
    // userB's own session is still valid - proves userA's deletion had zero effect on it.
    await authed(userB.accessToken, 'get', '/api/v1/users/me').expect(200);
  });

  it('is idempotent - a duplicate request (after re-login) re-verifies the password but does not reschedule or duplicate the audit trail', async () => {
    if (!dbAvailable || !app) return;
    const user = await createAndLoginUser('duplicate');
    const first = await authed(user.accessToken, 'delete', '/api/v1/users/me')
      .send({ password: PASSWORD })
      .expect(200);

    // Session was just revoked (sessionVersion bumped) - must log back in
    // with the still-valid password to reach the account again at all.
    const reLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    const secondToken = reLogin.body.data.accessToken as string;

    const second = await authed(secondToken, 'delete', '/api/v1/users/me')
      .send({ password: PASSWORD })
      .expect(200);

    expect(second.body.data.scheduledAnonymizationAt).toBe(
      first.body.data.scheduledAnonymizationAt,
    );

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'auth.account_deletion.requested', targetId: user.userId },
    });
    expect(auditRows).toHaveLength(1);
  });

  // -------------------------------------------------------------------
  // Open reservations gate
  // -------------------------------------------------------------------

  it('blocks (409) while an open Pending reservation exists', async () => {
    if (!dbAvailable || !app) return;
    const user = await createAndLoginUser('open-resv');
    const { restaurantId, branchId, tableId } = await seedOrgRestaurantBranchTable();
    await prisma.reservation.create({
      data: {
        userId: user.userId,
        restaurantId,
        branchId,
        tableId,
        reservationDate: new Date('2026-09-10T00:00:00.000Z'),
        reservationStartTime: new Date('2026-09-10T18:00:00.000Z'),
        reservationEndTime: new Date('2026-09-10T19:30:00.000Z'),
        guests: 2,
        status: 'Pending',
        source: 'Online',
        createdBy: user.userId,
      },
    });

    const response = await authed(user.accessToken, 'delete', '/api/v1/users/me')
      .send({ password: PASSWORD })
      .expect(409);
    expect(response.body.code).toBe('OPEN_RESERVATIONS_BLOCK_DELETION');

    const row = await prisma.user.findUnique({ where: { id: user.userId } });
    expect(row?.deletionRequestedAt).toBeNull();
  });

  it('does NOT block on an open conversation - only Reservations gate deletion', async () => {
    if (!dbAvailable || !app) return;
    const user = await createAndLoginUser('open-conv');
    const { restaurantId } = await seedOrgRestaurantBranchTable();
    const conversation = await prisma.conversation.create({
      data: { restaurantId, status: 'Open' },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderType: 'Customer',
        senderUserId: user.userId,
        body: 'hello, is my table ready?',
      },
    });

    await authed(user.accessToken, 'delete', '/api/v1/users/me')
      .send({ password: PASSWORD })
      .expect(200);
  });

  // -------------------------------------------------------------------
  // Multiple devices
  // -------------------------------------------------------------------

  it('revokes every device session across multiple concurrent logins', async () => {
    if (!dbAvailable || !app) return;
    const email = `${TEST_PREFIX}multi-${uniqueId()}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Multi',
        lastName: 'Device',
        email,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });
    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'mobile' })
      .expect(200);
    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);

    await authed(loginA.body.data.accessToken as string, 'delete', '/api/v1/users/me')
      .send({ password: PASSWORD })
      .expect(200);

    const sessions = await prisma.deviceSession.findMany({ where: { userId } });
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);

    // The second device's access token is also rejected immediately (same sessionVersion bump).
    await authed(loginB.body.data.accessToken as string, 'get', '/api/v1/users/me').expect(401);
  });

  // -------------------------------------------------------------------
  // Cancel within grace period
  // -------------------------------------------------------------------

  it('cancels a pending deletion request within the grace period after logging back in', async () => {
    if (!dbAvailable || !app) return;
    const user = await createAndLoginUser('cancel');
    await authed(user.accessToken, 'delete', '/api/v1/users/me')
      .send({ password: PASSWORD })
      .expect(200);

    const reLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    const freshToken = reLogin.body.data.accessToken as string;

    await authed(freshToken, 'post', '/api/v1/users/me/cancel-deletion').expect(204);

    const row = await prisma.user.findUnique({ where: { id: user.userId } });
    expect(row?.deletionRequestedAt).toBeNull();
    expect(row?.scheduledAnonymizationAt).toBeNull();

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'auth.account_deletion.cancelled', targetId: user.userId },
    });
    expect(auditRow).not.toBeNull();

    // The account remains fully usable afterward.
    await authed(freshToken, 'get', '/api/v1/users/me').expect(200);
  });

  it('cancel-deletion is idempotent - a no-op (still 204) when nothing is pending', async () => {
    if (!dbAvailable || !app) return;
    const user = await createAndLoginUser('cancel-noop');

    await authed(user.accessToken, 'post', '/api/v1/users/me/cancel-deletion').expect(204);
  });

  // -------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------

  it("exports the caller's own data and writes an audit trail entry", async () => {
    if (!dbAvailable || !app) return;
    const user = await createAndLoginUser('export');

    const response = await authed(user.accessToken, 'get', '/api/v1/users/me/export').expect(200);

    expect(response.body.data.profile.userId).toBe(user.userId);
    expect(response.body.data.reservations).toEqual({ items: [], total: 0 });
    expect(response.body.data.reviews).toEqual({ items: [], total: 0 });
    expect(response.body.data.favorites).toEqual({ items: [], total: 0 });

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'auth.data_export.requested', targetId: user.userId },
    });
    expect(auditRow).not.toBeNull();
  });

  // -------------------------------------------------------------------
  // Grace period elapsed - the actual anonymization
  // -------------------------------------------------------------------

  it('anonymizes the account once the grace period has elapsed, and it can never be requested/cancelled again', async () => {
    if (!dbAvailable || !app) return;
    const user = await createAndLoginUser('anonymize');
    await authed(user.accessToken, 'delete', '/api/v1/users/me')
      .send({ password: PASSWORD })
      .expect(200);

    const anonymizeUseCase = app.get(AnonymizeUserAccountUseCase);
    await anonymizeUseCase.execute({ userId: user.userId });

    const row = await prisma.user.findUnique({ where: { id: user.userId } });
    expect(row?.status).toBe('Anonymized');
    expect(row?.email).toMatch(/^deleted-.+@anonymized\.local$/);
    expect(row?.firstName).toBe('Deleted');
    expect(row?.phone).toBeNull();
    expect(row?.deletionRequestedAt).toBeNull();
    expect(row?.scheduledAnonymizationAt).toBeNull();

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'auth.account_deletion.anonymized', targetId: user.userId },
    });
    expect(auditRow).not.toBeNull();

    // The anonymized account can no longer authenticate at all.
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD, deviceType: 'web' })
      .expect(401);

    // Re-running the job (retry/duplicate delivery) is a safe no-op - no second audit row.
    await anonymizeUseCase.execute({ userId: user.userId });
    const auditRowsAfterRetry = await prisma.auditLog.findMany({
      where: { action: 'auth.account_deletion.anonymized', targetId: user.userId },
    });
    expect(auditRowsAfterRetry).toHaveLength(1);
  });

  it("deletes Favorites and anonymizes the customer's own Messages on anonymization", async () => {
    if (!dbAvailable || !app) return;
    const user = await createAndLoginUser('anon-cascade');
    const { restaurantId } = await seedOrgRestaurantBranchTable();
    await prisma.favorite.create({ data: { userId: user.userId, restaurantId } });
    const conversation = await prisma.conversation.create({
      data: { restaurantId, status: 'Open' },
    });
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderType: 'Customer',
        senderUserId: user.userId,
        body: 'call me at 555-1234',
      },
    });

    await authed(user.accessToken, 'delete', '/api/v1/users/me')
      .send({ password: PASSWORD })
      .expect(200);
    const anonymizeUseCase = app.get(AnonymizeUserAccountUseCase);
    await anonymizeUseCase.execute({ userId: user.userId });

    const favorites = await prisma.favorite.findMany({ where: { userId: user.userId } });
    expect(favorites).toHaveLength(0);

    const anonymizedMessage = await prisma.message.findUnique({ where: { id: message.id } });
    expect(anonymizedMessage?.body).toBe('[removed]');
    expect(anonymizedMessage?.anonymizedAt).not.toBeNull();
  });
});
