import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { createTestApp } from '../helpers/test-app.factory';
import { Argon2PasswordHasher } from '@modules/authentication/infrastructure/security/argon2-password-hasher';
import { Password } from '@shared/domain/value-objects/password.vo';
import authConfig from '@config/auth.config';
import { NOTIFICATION_PROVIDER } from '@modules/notifications/application/ports/notification-provider.port';
import { FakeNotificationProvider } from '@infrastructure/notifications/providers/fake/fake-notification.provider';
import { Notification } from '@modules/notifications/domain/entities/notification.entity';
import { NotificationPrismaMapper } from '@modules/notifications/infrastructure/persistence/notification.prisma-mapper';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'notifications-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * API_GUIDELINES.md's frozen Notification Endpoints (Phase 9, architecture
 * frozen 2026-07-25) - the four Customer-owned REST routes. Rows are seeded
 * directly via Prisma (not through event dispatch, which is covered by
 * `notification-dispatch-and-delivery.integration-spec.ts`) to keep this
 * suite focused on the REST/authorization contract.
 */
describe('/api/v1/notifications (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — Notifications e2e tests NOT EXECUTED.');
      return;
    }

    process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';
    process.env.ARGON2_MEMORY_COST = '4096';
    process.env.ARGON2_TIME_COST = '1';

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [authConfig] })],
      providers: [Argon2PasswordHasher],
    }).compile();
    const hasher = moduleRef.get(Argon2PasswordHasher);
    passwordHash = (await hasher.hash(Password.create(PASSWORD))).value;

    // Never exercises the real OneSignal HTTP boundary in this suite - the
    // four REST endpoints never call NotificationProviderPort themselves,
    // but the app boot still resolves the token, so this keeps it a fake.
    app = await createTestApp(
      [],
      [{ provide: NOTIFICATION_PROVIDER, useValue: new FakeNotificationProvider() }],
    );
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.notification.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.deviceSession.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function createAndLoginUser(
    suffix: string,
  ): Promise<{ accessToken: string; userId: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Notif',
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

    return { accessToken: loginResponse.body.data.accessToken as string, userId };
  }

  async function seedNotification(
    userId: string,
    overrides?: { read?: boolean; now?: Date },
  ): Promise<string> {
    const now = overrides?.now ?? new Date();
    let notification = Notification.create({
      id: randomUUID(),
      userId,
      type: 'ReservationApproved',
      templateId: null,
      title: 'Reservation confirmed',
      body: 'Your reservation has been confirmed.',
      data: { reservationId: randomUUID() },
      now,
    });
    if (overrides?.read) {
      notification = notification.markRead(now);
    }
    await prisma.notification.create({
      data: NotificationPrismaMapper.toPersistence(notification),
    });
    return notification.id;
  }

  describe('GET /notifications', () => {
    it('lists only the caller own notifications, newest first, excluding push* fields', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('list');
      await seedNotification(user.userId, { now: new Date('2026-07-01T00:00:00.000Z') });
      const newerId = await seedNotification(user.userId, {
        now: new Date('2026-07-10T00:00:00.000Z'),
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(response.body.data.total).toBe(2);
      expect(response.body.data.items[0].id).toBe(newerId);
      expect(response.body.data.items[0]).not.toHaveProperty('pushStatus');
      expect(response.body.data.items[0]).not.toHaveProperty('pushIdempotencyKey');
      expect(response.body.data.items[0]).toHaveProperty('title');
      expect(response.body.data.items[0]).toHaveProperty('data');
    });

    it('only returns unread notifications when unread=true', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('list-unread');
      await seedNotification(user.userId, { read: true });
      const unreadId = await seedNotification(user.userId, { read: false });

      const response = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .query({ unread: 'true' })
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0].id).toBe(unreadId);
    });

    it("never returns another user's notifications", async () => {
      if (!dbAvailable || !app) return;
      const userA = await createAndLoginUser('isolation-a');
      const userB = await createAndLoginUser('isolation-b');
      await seedNotification(userA.userId);

      const responseB = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(responseB.body.data.total).toBe(0);
    });

    it('rejects a request with no Authorization header', async () => {
      if (!dbAvailable || !app) return;
      const response = await request(app.getHttpServer()).get('/api/v1/notifications').expect(401);
      expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
    });
  });

  describe('GET /notifications/unread-count', () => {
    it('returns the count of the caller own unread notifications only', async () => {
      if (!dbAvailable || !app) return;
      const userA = await createAndLoginUser('count-a');
      const userB = await createAndLoginUser('count-b');
      await seedNotification(userA.userId, { read: false });
      await seedNotification(userA.userId, { read: false });
      await seedNotification(userA.userId, { read: true });
      await seedNotification(userB.userId, { read: false });

      const responseA = await request(app.getHttpServer())
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);
      const responseB = await request(app.getHttpServer())
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(responseA.body.data.count).toBe(2);
      expect(responseB.body.data.count).toBe(1);
    });
  });

  describe('PATCH /notifications/:id/read', () => {
    it('marks the caller own notification read', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('read-one');
      const notificationId = await seedNotification(user.userId, { read: false });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${notificationId}/read`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(response.body.data.read).toBe(true);
      expect(response.body.data.readAt).toBeTruthy();

      const row = await prisma.notification.findUnique({ where: { id: notificationId } });
      expect(row?.read).toBe(true);
    });

    it('is idempotent - marking an already-read notification read again succeeds', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('read-idempotent');
      const notificationId = await seedNotification(user.userId, { read: true });

      await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${notificationId}/read`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
    });

    it('returns 404 for a nonexistent notification', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('read-not-found');

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${randomUUID()}/read`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it("returns 404 (IDOR-safe, not 403) for another user's notification", async () => {
      if (!dbAvailable || !app) return;
      const victim = await createAndLoginUser('read-idor-victim');
      const attacker = await createAndLoginUser('read-idor-attacker');
      const victimNotificationId = await seedNotification(victim.userId, { read: false });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${victimNotificationId}/read`)
        .set('Authorization', `Bearer ${attacker.accessToken}`)
        .expect(404);
      expect(response.body.code).toBe('NOT_FOUND');

      const row = await prisma.notification.findUnique({ where: { id: victimNotificationId } });
      expect(row?.read).toBe(false); // untouched
    });

    it('rejects a malformed id with 400', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('read-malformed');

      const response = await request(app.getHttpServer())
        .patch('/api/v1/notifications/not-a-uuid/read')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH /notifications/read-all', () => {
    it("marks all of the caller's unread notifications read, without touching another user's", async () => {
      if (!dbAvailable || !app) return;
      const userA = await createAndLoginUser('read-all-a');
      const userB = await createAndLoginUser('read-all-b');
      await seedNotification(userA.userId, { read: false });
      await seedNotification(userA.userId, { read: false });
      const otherUserNotificationId = await seedNotification(userB.userId, { read: false });

      await request(app.getHttpServer())
        .patch('/api/v1/notifications/read-all')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      const remainingUnreadA = await prisma.notification.count({
        where: { userId: userA.userId, read: false },
      });
      expect(remainingUnreadA).toBe(0);

      const otherRow = await prisma.notification.findUnique({
        where: { id: otherUserNotificationId },
      });
      expect(otherRow?.read).toBe(false); // untouched
    });

    it('rejects a request with no Authorization header', async () => {
      if (!dbAvailable || !app) return;
      const response = await request(app.getHttpServer())
        .patch('/api/v1/notifications/read-all')
        .expect(401);
      expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
    });
  });

  describe('GET /notifications/identity-token (ADR-025 delivery)', () => {
    it('returns a null token with the configured expiry when Identity Verification is unconfigured', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('identity-token');

      const response = await request(app.getHttpServer())
        .get('/api/v1/notifications/identity-token')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      // No ONESIGNAL_IDENTITY_VERIFICATION_PRIVATE_KEY in the test env -> the
      // signer fails closed (null), never a fabricated/unsigned token.
      expect(response.body.data).toEqual({ token: null, expiresInSeconds: 3600 });
      expect(response.body.data).not.toHaveProperty('accessToken');
    });

    it('rejects a request with no Authorization header', async () => {
      if (!dbAvailable || !app) return;
      const response = await request(app.getHttpServer())
        .get('/api/v1/notifications/identity-token')
        .expect(401);
      expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
    });
  });
});
