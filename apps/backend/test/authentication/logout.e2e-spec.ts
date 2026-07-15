import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { Argon2PasswordHasher } from '@modules/authentication/infrastructure/security/argon2-password-hasher';
import { Password } from '@shared/domain/value-objects/password.vo';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import authConfig from '@config/auth.config';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'logout-e2e-';
const TEST_PASSWORD = 'SecurePass123!';

describe('Authentication logout flows (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — logout e2e tests NOT EXECUTED.');
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
    passwordHash = (await hasher.hash(Password.create(TEST_PASSWORD))).value;

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
      await prisma.user.deleteMany({
        where: { email: { startsWith: TEST_PREFIX } },
      });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function registerAndLogin(email: string, deviceName: string) {
    // Reuses an existing row for this email instead of always creating a new
    // one: FLOW B/C log the same account in from two "devices", which must
    // resolve to a single User row now that users.email is unique at the
    // database level (see migration 20260710190000_add_users_email_unique_constraint).
    const existing = await prisma.user.findFirst({ where: { email } });
    if (!existing) {
      await prisma.user.create({
        data: {
          id: randomUUID(),
          firstName: 'Logout',
          lastName: 'E2E',
          email,
          passwordHash,
          language: 'en',
          status: UserStatus.Active,
          emailVerified: true,
        },
      });
    }

    const login = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD, deviceName, deviceType: 'web' })
      .expect(200);

    return login.body.data as {
      accessToken: string;
      refreshToken: string;
      sessionId: string;
      sessionVersion: number;
    };
  }

  it('FLOW A: logout invalidates refresh but access token remains valid until expiry', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const email = `${TEST_PREFIX}flow-a@example.com`;
    const login = await registerAndLogin(email, 'Flow A Device');

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${login.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${login.accessToken}`)
      .expect(200);
  });

  it('FLOW B: revoke another device session while current remains active', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const email = `${TEST_PREFIX}flow-b@example.com`;
    const deviceA = await registerAndLogin(email, 'Device A');
    const deviceB = await registerAndLogin(email, 'Device B');

    const sessions = await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${deviceA.accessToken}`)
      .expect(200);

    expect(sessions.body.data.sessions).toHaveLength(2);

    const otherSession = sessions.body.data.sessions.find(
      (session: { isCurrentSession: boolean }) => !session.isCurrentSession,
    );

    await request(app.getHttpServer())
      .delete(`/api/v1/auth/sessions/${otherSession.sessionId}`)
      .set('Authorization', `Bearer ${deviceA.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: deviceB.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: deviceA.refreshToken })
      .expect(200);
  });

  it('FLOW C: logout-all rejects stale access tokens via SessionVersionGuard', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const email = `${TEST_PREFIX}flow-c@example.com`;
    const deviceA = await registerAndLogin(email, 'Device A');
    const deviceB = await registerAndLogin(email, 'Device B');

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${deviceA.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: deviceA.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: deviceB.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${deviceB.accessToken}`)
      .expect(401);
  });

  it('FLOW D: cross-user session revocation is rejected without leakage', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const userA = await registerAndLogin(`${TEST_PREFIX}flow-d-a@example.com`, 'User A');
    const userB = await registerAndLogin(`${TEST_PREFIX}flow-d-b@example.com`, 'User B');

    const response = await request(app.getHttpServer())
      .delete(`/api/v1/auth/sessions/${userB.sessionId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(404);

    expect(response.body.code).toBe('AUTH_SESSION_NOT_FOUND');
  });
});
