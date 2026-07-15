import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { createTestApp } from '../helpers/test-app.factory';
import { Argon2PasswordHasher } from '@modules/authentication/infrastructure/security/argon2-password-hasher';
import { Password } from '@shared/domain/value-objects/password.vo';
import authConfig from '@config/auth.config';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'favorites-e2e-';
const PASSWORD = 'SecurePass123!';
const ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

describe('/api/v1/users/me/favorites (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';
  let organizationId: string;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — Favorites e2e tests NOT EXECUTED.');
      return;
    }

    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';
    process.env.ARGON2_MEMORY_COST = '4096';
    process.env.ARGON2_TIME_COST = '1';

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [authConfig] })],
      providers: [Argon2PasswordHasher],
    }).compile();
    const hasher = moduleRef.get(Argon2PasswordHasher);
    passwordHash = (await hasher.hash(Password.create(PASSWORD))).value;

    app = await createTestApp();

    organizationId = randomUUID();
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: `${TEST_PREFIX}org`,
        slug: `${TEST_PREFIX}${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}${randomUUID()}@example.com`,
      },
    });
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.favorite.deleteMany({ where: { restaurant: { organizationId } } });
      await prisma.restaurant.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
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
  ): Promise<{ accessToken: string; email: string; userId: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Favorites',
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
    const accessToken = loginResponse.body.data.accessToken as string;

    return { accessToken, email, userId };
  }

  async function seedRestaurant(overrides?: { deletedAt?: Date | null }): Promise<string> {
    const restaurantId = randomUUID();
    await prisma.restaurant.create({
      data: {
        id: restaurantId,
        organizationId,
        name: `${TEST_PREFIX}restaurant`,
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: 'Active',
        deletedAt: overrides?.deletedAt ?? null,
      },
    });
    return restaurantId;
  }

  // ---------------------------------------------------------------------
  // ADD
  // ---------------------------------------------------------------------

  describe('POST /users/me/favorites/:restaurantId', () => {
    it('adds a favorite and persists it', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('add-success');
      const restaurantId = await seedRestaurant();

      const response = await request(app.getHttpServer())
        .post(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.restaurantId).toBe(restaurantId);
      expect(response.body.data.favoritedAt).toBeTruthy();

      const row = await prisma.favorite.findUnique({
        where: { userId_restaurantId: { userId: user.userId, restaurantId } },
      });
      expect(row).not.toBeNull();
    });

    it('is idempotent: favoriting the same restaurant twice does not error or duplicate', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('add-duplicate');
      const restaurantId = await seedRestaurant();

      await request(app.getHttpServer())
        .post(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const rows = await prisma.favorite.findMany({
        where: { userId: user.userId, restaurantId },
      });
      expect(rows).toHaveLength(1);
    });

    it('rejects a nonexistent restaurant with 404', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('add-not-found');

      const response = await request(app.getHttpServer())
        .post(`/api/v1/users/me/favorites/${randomUUID()}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('rejects a soft-deleted restaurant with 404', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('add-deleted');
      const restaurantId = await seedRestaurant({ deletedAt: new Date() });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('rejects a malformed restaurantId with 400', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('add-malformed');

      const response = await request(app.getHttpServer())
        .post('/api/v1/users/me/favorites/not-a-uuid')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a request with no Authorization header', async () => {
      if (!dbAvailable || !app) return;
      const restaurantId = await seedRestaurant();

      const response = await request(app.getHttpServer())
        .post(`/api/v1/users/me/favorites/${restaurantId}`)
        .expect(401);
      expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
    });

    it('rejects an invalid access token', async () => {
      if (!dbAvailable || !app) return;
      const restaurantId = await seedRestaurant();

      const response = await request(app.getHttpServer())
        .post(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
      expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
    });

    it('rejects an expired access token', async () => {
      if (!dbAvailable || !app) return;
      const restaurantId = await seedRestaurant();
      const expiredToken = jwt.sign(
        {
          sub: randomUUID(),
          actorType: 'User',
          sessionId: randomUUID(),
          sessionVersion: 1,
          tokenFamilyId: randomUUID(),
        },
        ACCESS_SECRET,
        {
          algorithm: 'HS256',
          issuer: 'tavla-api',
          audience: 'tavla-clients',
          expiresIn: -10,
          keyid: 'current',
        },
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
      expect(response.body.code).toBe('AUTH_EXPIRED_TOKEN');
    });

    it('rejects a stale access token after logout-all bumps sessionVersion', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('add-stale-session');
      const restaurantId = await seedRestaurant();

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(204);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(401);
      expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
    });

    it('a forged userId/organizationId cannot redirect ownership of the favorite', async () => {
      if (!dbAvailable || !app) return;
      const victim = await createAndLoginUser('add-victim');
      const attacker = await createAndLoginUser('add-attacker');
      const restaurantId = await seedRestaurant();

      await request(app.getHttpServer())
        .post(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', `Bearer ${attacker.accessToken}`)
        .set('X-User-Id', victim.userId)
        .query({ userId: victim.userId, organizationId: randomUUID() })
        .expect(200);

      const attackerRow = await prisma.favorite.findUnique({
        where: { userId_restaurantId: { userId: attacker.userId, restaurantId } },
      });
      const victimRow = await prisma.favorite.findUnique({
        where: { userId_restaurantId: { userId: victim.userId, restaurantId } },
      });
      expect(attackerRow).not.toBeNull();
      expect(victimRow).toBeNull();
    });

    it('concurrent duplicate adds preserve the unique invariant with no unhandled 500', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('add-concurrent');
      const restaurantId = await seedRestaurant();

      const responses = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/users/me/favorites/${restaurantId}`)
          .set('Authorization', `Bearer ${user.accessToken}`),
        request(app.getHttpServer())
          .post(`/api/v1/users/me/favorites/${restaurantId}`)
          .set('Authorization', `Bearer ${user.accessToken}`),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(200);
      }
      const rows = await prisma.favorite.findMany({
        where: { userId: user.userId, restaurantId },
      });
      expect(rows).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------
  // LIST
  // ---------------------------------------------------------------------

  describe('GET /users/me/favorites', () => {
    it('returns an empty list when the user has no favorites', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('list-empty');

      const response = await request(app.getHttpServer())
        .get('/api/v1/users/me/favorites')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(response.body.data.items).toEqual([]);
      expect(response.body.data.total).toBe(0);
    });

    it('lists favorited restaurants ordered most-recently-favorited first, without sensitive fields', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('list-populated');
      const restaurantOld = await seedRestaurant();
      const restaurantNew = await seedRestaurant();

      await request(app.getHttpServer())
        .post(`/api/v1/users/me/favorites/${restaurantOld}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/users/me/favorites/${restaurantNew}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const response = await request(app.getHttpServer())
        .get('/api/v1/users/me/favorites')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(
        response.body.data.items.map((item: { restaurantId: string }) => item.restaurantId),
      ).toEqual([restaurantNew, restaurantOld]);
      expect(response.body.data.total).toBe(2);
      for (const item of response.body.data.items) {
        expect(item).not.toHaveProperty('organizationId');
      }
    });

    it("only returns the current user's own favorites", async () => {
      if (!dbAvailable || !app) return;
      const userA = await createAndLoginUser('list-isolation-a');
      const userB = await createAndLoginUser('list-isolation-b');
      const restaurantId = await seedRestaurant();

      await request(app.getHttpServer())
        .post(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      const responseA = await request(app.getHttpServer())
        .get('/api/v1/users/me/favorites')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);
      const responseB = await request(app.getHttpServer())
        .get('/api/v1/users/me/favorites')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(responseA.body.data.total).toBe(1);
      expect(responseB.body.data.total).toBe(0);
    });

    it('excludes a favorite whose restaurant has since been soft-deleted', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('list-deleted-target');
      const restaurantId = await seedRestaurant();

      await request(app.getHttpServer())
        .post(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      await prisma.restaurant.update({
        where: { id: restaurantId },
        data: { deletedAt: new Date() },
      });

      const response = await request(app.getHttpServer())
        .get('/api/v1/users/me/favorites')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(response.body.data.items).toEqual([]);
      expect(response.body.data.total).toBe(1); // raw Favorite count, documented limitation
    });

    it('paginates using page/limit query params', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('list-pagination');
      for (let index = 0; index < 3; index += 1) {
        const restaurantId = await seedRestaurant();
        await request(app.getHttpServer())
          .post(`/api/v1/users/me/favorites/${restaurantId}`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);
      }

      const firstPage = await request(app.getHttpServer())
        .get('/api/v1/users/me/favorites')
        .query({ page: 1, limit: 2 })
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      const secondPage = await request(app.getHttpServer())
        .get('/api/v1/users/me/favorites')
        .query({ page: 2, limit: 2 })
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(firstPage.body.data.items).toHaveLength(2);
      expect(secondPage.body.data.items).toHaveLength(1);
      expect(firstPage.body.data.total).toBe(3);
    });

    it('rejects an invalid limit (out of range) with 400', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('list-invalid-limit');

      const response = await request(app.getHttpServer())
        .get('/api/v1/users/me/favorites')
        .query({ limit: 1000 })
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unsupported query fields (mass assignment via query string)', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('list-unsupported-query');

      const response = await request(app.getHttpServer())
        .get('/api/v1/users/me/favorites')
        .query({ userId: randomUUID() })
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a request with no Authorization header', async () => {
      if (!dbAvailable || !app) return;

      const response = await request(app.getHttpServer())
        .get('/api/v1/users/me/favorites')
        .expect(401);
      expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
    });
  });

  // ---------------------------------------------------------------------
  // REMOVE
  // ---------------------------------------------------------------------

  describe('DELETE /users/me/favorites/:restaurantId', () => {
    it('removes an existing favorite', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('remove-success');
      const restaurantId = await seedRestaurant();
      await request(app.getHttpServer())
        .post(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(204);

      const row = await prisma.favorite.findUnique({
        where: { userId_restaurantId: { userId: user.userId, restaurantId } },
      });
      expect(row).toBeNull();
    });

    it('is idempotent: removing an absent favorite is still 204', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('remove-idempotent');
      const restaurantId = await seedRestaurant();

      await request(app.getHttpServer())
        .delete(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(204);
      await request(app.getHttpServer())
        .delete(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(204);
    });

    it("one user cannot remove another user's favorite via a forged userId", async () => {
      if (!dbAvailable || !app) return;
      const victim = await createAndLoginUser('remove-victim');
      const attacker = await createAndLoginUser('remove-attacker');
      const restaurantId = await seedRestaurant();
      await request(app.getHttpServer())
        .post(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', `Bearer ${victim.accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', `Bearer ${attacker.accessToken}`)
        .set('X-User-Id', victim.userId)
        .query({ userId: victim.userId })
        .expect(204); // idempotent no-op for the attacker's own (nonexistent) favorite

      const victimRow = await prisma.favorite.findUnique({
        where: { userId_restaurantId: { userId: victim.userId, restaurantId } },
      });
      expect(victimRow).not.toBeNull(); // untouched
    });

    it('rejects a request with no Authorization header', async () => {
      if (!dbAvailable || !app) return;
      const restaurantId = await seedRestaurant();

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/users/me/favorites/${restaurantId}`)
        .expect(401);
      expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
    });

    it('rejects a stale access token after logout-all bumps sessionVersion', async () => {
      if (!dbAvailable || !app) return;
      const user = await createAndLoginUser('remove-stale-session');
      const restaurantId = await seedRestaurant();

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(204);

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/users/me/favorites/${restaurantId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(401);
      expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
    });
  });
});
