import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'notif-broadcast-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

function randomDigits(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(Math.random() * 10).toString();
  }
  return out;
}

/** Matches customer-login.e2e-spec.ts's exact (countryCode, phoneNumber) -> canonical E.164 shape. */
function syrianPhone(): { countryCode: string; phoneNumber: string } {
  return { countryCode: 'SY', phoneNumber: `09${randomDigits(8)}` };
}

/**
 * Phase 19.9 (ADR-037) e2e coverage: the internal notification system's HTTP/
 * authorization contract for Platform Admin -> one Customer, Platform
 * Admin -> all Customers, and Restaurant Owner -> all Customers. Broadcast
 * fan-out completion itself (audience resolution, batch insert) is covered
 * against real Postgres in notification-broadcast.integration-spec.ts,
 * driving ProcessNotificationBroadcastFanoutUseCase directly - this suite
 * only proves the route/guard/validation/response-shape contract, since
 * relying on the real BullMQ worker actually finishing the job within a test
 * would be flaky by construction.
 */
describe('Internal Notification System - Platform Admin & Restaurant Owner authoring (e2e, Phase 19.9)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — Notification broadcast e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.notification.deleteMany({
        where: {
          OR: [
            { user: { username: { startsWith: TEST_PREFIX } } },
            { user: { email: { startsWith: TEST_PREFIX } } },
          ],
        },
      });
      await prisma.notificationBroadcast.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
      await prisma.employee.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.role.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
      await prisma.organizationMember.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.subscriptionUsage.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.subscription.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
      await prisma.platformAdmin.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organization.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
      await prisma.deviceSession.deleteMany({
        where: {
          user: {
            OR: [{ email: { startsWith: TEST_PREFIX } }, { username: { startsWith: TEST_PREFIX } }],
          },
        },
      });
      await prisma.tokenFamily.deleteMany({
        where: {
          user: {
            OR: [{ email: { startsWith: TEST_PREFIX } }, { username: { startsWith: TEST_PREFIX } }],
          },
        },
      });
      await prisma.user.deleteMany({
        where: { OR: [{ email: { startsWith: TEST_PREFIX } }, { username: { startsWith: TEST_PREFIX } }] },
      });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function seedPlatformAdmin(role: 'PlatformAdmin' | 'PlatformSupport' = 'PlatformAdmin') {
    const email = `${TEST_PREFIX}admin-${uniqueId()}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Platform',
        lastName: role,
        email,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });
    await prisma.platformAdmin.create({
      data: { id: randomUUID(), userId, role, revokedAt: null },
    });
    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/platform-admin/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { accessToken: loginResponse.body.data.accessToken as string, userId };
  }

  async function seedCustomer() {
    const userId = randomUUID();
    const username = `${TEST_PREFIX}${uniqueId()}`;
    const phone = syrianPhone();
    const canonicalPhone = `+963${phone.phoneNumber.replace(/^0/, '')}`;
    await prisma.user.create({
      data: {
        id: userId,
        username,
        phone: canonicalPhone,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        marketingOptIn: true,
      },
    });
    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/customer/login')
      .send({ ...phone, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    return { accessToken: loginResponse.body.data.accessToken as string, userId };
  }

  async function registerAndLoginOwner(suffix: string) {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const { userId, organizationId } = await seedOwnerAndOrganization(prisma, {
      email,
      passwordHash,
      lastName: suffix,
      organizationName: `${TEST_PREFIX}Org ${suffix} ${uniqueId()}`,
    });
    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    return { accessToken: loginResponse.body.data.accessToken as string, userId, organizationId, email };
  }

  async function createRestaurant(ownerAccessToken: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ name: 'Notif Broadcast Test Restaurant', slug: `${TEST_PREFIX}restaurant-${uniqueId()}` })
      .expect(201);
    return response.body.data.restaurantId as string;
  }

  async function addStaffMember(organizationId: string): Promise<{ accessToken: string }> {
    const email = `${TEST_PREFIX}staff-${uniqueId()}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Staff',
        lastName: 'Member',
        email,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });
    await prisma.organizationMember.create({
      data: {
        id: randomUUID(),
        organizationId,
        userId,
        role: 'Staff',
        status: 'Active',
        invitedAt: new Date(),
        joinedAt: new Date(),
      },
    });
    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    return { accessToken: loginResponse.body.data.accessToken as string };
  }

  // -------------------------------------------------------------------
  // POST /platform-admin/notifications (send to one Customer)
  // -------------------------------------------------------------------

  describe('POST /platform-admin/notifications', () => {
    it('sends a notification to an eligible Customer, visible via GET /notifications for that Customer', async () => {
      if (!dbAvailable || !app) return;
      const admin = await seedPlatformAdmin();
      const customer = await seedCustomer();

      const response = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/notifications')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetUserId: customer.userId, title: 'Welcome!', body: 'Thanks for joining.' })
        .expect(201);

      expect(response.body.data.notificationId).toBeTruthy();

      const listResponse = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);
      expect(listResponse.body.data.items[0].title).toBe('Welcome!');
    });

    it('returns 403 for a PlatformSupport-tier admin (mutation-only endpoint)', async () => {
      if (!dbAvailable || !app) return;
      const support = await seedPlatformAdmin('PlatformSupport');
      const customer = await seedCustomer();

      const response = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/notifications')
        .set('Authorization', `Bearer ${support.accessToken}`)
        .send({ targetUserId: customer.userId, title: 'Welcome!', body: 'Body' })
        .expect(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('rejects a request with no Authorization header (PlatformAdminGuard uniformly returns 403, never 401)', async () => {
      if (!dbAvailable || !app) return;
      await request(app.getHttpServer())
        .post('/api/v1/platform-admin/notifications')
        .send({ targetUserId: randomUUID(), title: 'Welcome!', body: 'Body' })
        .expect(403);
    });

    it("returns 404 (IDOR-safe) when targetUserId is an OrganizationMember, never an internal identity's inbox", async () => {
      if (!dbAvailable || !app) return;
      const admin = await seedPlatformAdmin();
      const owner = await registerAndLoginOwner('target-idor-owner');

      const response = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/notifications')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetUserId: owner.userId, title: 'Welcome!', body: 'Body' })
        .expect(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('returns 404 for a nonexistent targetUserId', async () => {
      if (!dbAvailable || !app) return;
      const admin = await seedPlatformAdmin();

      const response = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/notifications')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetUserId: randomUUID(), title: 'Welcome!', body: 'Body' })
        .expect(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('returns 400 for an empty title', async () => {
      if (!dbAvailable || !app) return;
      const admin = await seedPlatformAdmin();
      const customer = await seedCustomer();

      const response = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/notifications')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetUserId: customer.userId, title: '', body: 'Body' })
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  // -------------------------------------------------------------------
  // POST /platform-admin/notifications/broadcast
  // -------------------------------------------------------------------

  describe('POST /platform-admin/notifications/broadcast', () => {
    it('queues a broadcast and returns 202 with a broadcastId and totalRecipients snapshot', async () => {
      if (!dbAvailable || !app) return;
      const admin = await seedPlatformAdmin();

      const response = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/notifications/broadcast')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ title: `${TEST_PREFIX}Holiday Hours`, body: 'We are open this holiday!' })
        .expect(202);

      expect(response.body.data.broadcastId).toBeTruthy();
      expect(typeof response.body.data.totalRecipients).toBe('number');

      const row = await prisma.notificationBroadcast.findUnique({
        where: { id: response.body.data.broadcastId },
      });
      expect(row).not.toBeNull();
      expect(row?.senderType).toBe('PlatformAdmin');
      expect(row?.senderId).toBe(admin.userId);
    });

    it('returns 403 for a PlatformSupport-tier admin', async () => {
      if (!dbAvailable || !app) return;
      const support = await seedPlatformAdmin('PlatformSupport');

      const response = await request(app.getHttpServer())
        .post('/api/v1/platform-admin/notifications/broadcast')
        .set('Authorization', `Bearer ${support.accessToken}`)
        .send({ title: `${TEST_PREFIX}Denied`, body: 'Body' })
        .expect(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('rejects a request with no Authorization header (PlatformAdminGuard uniformly returns 403, never 401)', async () => {
      if (!dbAvailable || !app) return;
      await request(app.getHttpServer())
        .post('/api/v1/platform-admin/notifications/broadcast')
        .send({ title: 'Title', body: 'Body' })
        .expect(403);
    });
  });

  // -------------------------------------------------------------------
  // POST /restaurants/:restaurantId/notifications/broadcast
  // -------------------------------------------------------------------

  describe('POST /restaurants/:restaurantId/notifications/broadcast', () => {
    it('queues a broadcast for the Restaurant Owner and returns 202, audit-attributed to that org', async () => {
      if (!dbAvailable || !app) return;
      const owner = await registerAndLoginOwner('broadcast-owner');
      const restaurantId = await createRestaurant(owner.accessToken);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/notifications/broadcast`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ title: `${TEST_PREFIX}Restaurant Special`, body: 'Special menu this week!' })
        .expect(202);

      expect(response.body.data.broadcastId).toBeTruthy();

      const row = await prisma.notificationBroadcast.findUnique({
        where: { id: response.body.data.broadcastId },
      });
      expect(row?.senderType).toBe('OrganizationMember');
      expect(row?.senderId).toBe(owner.userId);
      expect(row?.organizationId).toBe(owner.organizationId);
    });

    it('returns 403 for a Staff-role organization member (Owner/Admin only)', async () => {
      if (!dbAvailable || !app) return;
      const owner = await registerAndLoginOwner('broadcast-staff-denied');
      const restaurantId = await createRestaurant(owner.accessToken);
      const staff = await addStaffMember(owner.organizationId);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/notifications/broadcast`)
        .set('Authorization', `Bearer ${staff.accessToken}`)
        .send({ title: 'Title', body: 'Body' })
        .expect(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it("returns 404 (IDOR-safe, not 403) when the restaurant belongs to a different Organization", async () => {
      if (!dbAvailable || !app) return;
      const ownerA = await registerAndLoginOwner('broadcast-idor-a');
      const ownerB = await registerAndLoginOwner('broadcast-idor-b');
      const restaurantOfB = await createRestaurant(ownerB.accessToken);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantOfB}/notifications/broadcast`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({ title: 'Title', body: 'Body' })
        .expect(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('rejects a request with no Authorization header', async () => {
      if (!dbAvailable || !app) return;
      await request(app.getHttpServer())
        .post(`/api/v1/restaurants/${randomUUID()}/notifications/broadcast`)
        .send({ title: 'Title', body: 'Body' })
        .expect(401);
    });

    it('returns 400 for a malformed restaurantId', async () => {
      if (!dbAvailable || !app) return;
      const owner = await registerAndLoginOwner('broadcast-malformed');

      const response = await request(app.getHttpServer())
        .post('/api/v1/restaurants/not-a-uuid/notifications/broadcast')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ title: 'Title', body: 'Body' })
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });
});
