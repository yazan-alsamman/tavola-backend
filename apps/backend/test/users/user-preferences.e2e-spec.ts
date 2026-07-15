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
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'user-preferences-e2e-';
const PASSWORD = 'SecurePass123!';

const VALID_PATCH_BODY = {
  notificationOptIn: false,
  marketingOptIn: true,
};

/** Short unique suffix - see the same precaution in user-profile.e2e-spec.ts. */
function uniqueId(): string {
  return randomUUID().split('-')[0];
}

describe('GET/PATCH /api/v1/users/me/preferences (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — user preferences e2e tests NOT EXECUTED.');
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

    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
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
        firstName: 'Original',
        lastName: 'Name',
        email,
        phone: null,
        passwordHash,
        language: 'en',
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

  it('GET returns the documented default opt-ins for a freshly created user', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken, userId } = await createAndLoginUser('get-defaults');

    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me/preferences')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data).toMatchObject({
      userId,
      notificationOptIn: true,
      marketingOptIn: false,
    });
    expect(response.body.data).not.toHaveProperty('language');
    expect(response.body.data).not.toHaveProperty('preferredCurrency');
    expect(response.body.data).not.toHaveProperty('passwordHash');
  });

  it('PATCH updates preferences and persists them', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken, userId } = await createAndLoginUser('patch-success');

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me/preferences')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(VALID_PATCH_BODY)
      .expect(200);

    expect(response.body.data).toMatchObject({
      userId,
      notificationOptIn: false,
      marketingOptIn: true,
    });

    const persisted = await prisma.user.findUnique({ where: { id: userId } });
    expect(persisted?.notificationOptIn).toBe(false);
    expect(persisted?.marketingOptIn).toBe(true);
    // Unrelated Authentication/profile fields must survive untouched.
    expect(persisted?.passwordHash).toBe(passwordHash);
    expect(persisted?.language).toBe('en');

    const auditEntry = await prisma.auditLog.findFirst({
      where: { targetId: userId, action: 'user.preferences.updated' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.actorId).toBe(userId);

    const getResponse = await request(app.getHttpServer())
      .get('/api/v1/users/me/preferences')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(getResponse.body.data).toMatchObject({
      notificationOptIn: false,
      marketingOptIn: true,
    });
  });

  it('GET rejects a request with no Authorization header', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me/preferences')
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('PATCH rejects a request with no Authorization header', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me/preferences')
      .send(VALID_PATCH_BODY)
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('PATCH rejects a stale access token after logout-all bumps sessionVersion', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken } = await createAndLoginUser('stale-session');

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me/preferences')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(VALID_PATCH_BODY)
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('PATCH rejects a non-boolean value with 400', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken } = await createAndLoginUser('validation');

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me/preferences')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ notificationOptIn: 'yes', marketingOptIn: true })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH rejects a missing required field with 400', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken } = await createAndLoginUser('validation-missing');

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me/preferences')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ notificationOptIn: true })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH rejects unknown/mass-assignment properties, including language/preferredCurrency and identity fields', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken, userId, email } = await createAndLoginUser('mass-assignment');

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me/preferences')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        ...VALID_PATCH_BODY,
        id: randomUUID(),
        userId: randomUUID(),
        organizationId: randomUUID(),
        email: 'attacker@example.com',
        language: 'ar',
        preferredCurrency: 'USD',
        sessionVersion: 999,
        status: 'Active',
      })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');

    // Belt-and-suspenders: confirm nothing leaked through despite rejection.
    const persisted = await prisma.user.findUnique({ where: { id: userId } });
    expect(persisted?.email).toBe(email);
    expect(persisted?.language).toBe('en');
    expect(persisted?.sessionVersion).toBe(1);
  });

  it("two different users never see each other's preferences - identity comes only from the JWT", async () => {
    if (!dbAvailable || !app) return;

    const userA = await createAndLoginUser('isolation-a');
    const userB = await createAndLoginUser('isolation-b');

    await request(app.getHttpServer())
      .patch('/api/v1/users/me/preferences')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ notificationOptIn: false, marketingOptIn: true })
      .expect(200);

    const responseB = await request(app.getHttpServer())
      .get('/api/v1/users/me/preferences')
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .expect(200);

    expect(responseB.body.data.userId).toBe(userB.userId);
    expect(responseB.body.data.userId).not.toBe(userA.userId);
    expect(responseB.body.data.notificationOptIn).toBe(true);
    expect(responseB.body.data.marketingOptIn).toBe(false);
  });

  it('GET ignores any client-supplied identity - the target is always the JWT actor', async () => {
    if (!dbAvailable || !app) return;

    const userA = await createAndLoginUser('spoof-a');
    const userB = await createAndLoginUser('spoof-b');

    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me/preferences')
      .query({ userId: userB.userId, organizationId: randomUUID() })
      .set('X-User-Id', userB.userId)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(200);

    expect(response.body.data.userId).toBe(userA.userId);
    expect(response.body.data.userId).not.toBe(userB.userId);
  });
});
