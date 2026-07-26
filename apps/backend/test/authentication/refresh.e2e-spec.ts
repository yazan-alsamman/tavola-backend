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
const TEST_PREFIX = 'refresh-e2e-';
const TEST_PASSWORD = 'SecurePass123!';

describe('POST /api/v1/auth/refresh (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn(
        'PostgreSQL not reachable — refresh e2e tests NOT EXECUTED. Start Docker stack per ENVIRONMENT_SETUP.md.',
      );
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

  async function login(email: string) {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD, deviceType: 'web' })
      .expect(200);

    return response.body.data as {
      refreshToken: string;
      accessToken: string;
      sessionId: string;
    };
  }

  it('rotates refresh token after login and invalidates the previous token', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const email = `${TEST_PREFIX}rotate@example.com`;
    await prisma.user.create({
      data: {
        id: randomUUID(),
        firstName: 'Refresh',
        lastName: 'E2E',
        email,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });

    const loginResult = await login(email);
    const refreshResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginResult.refreshToken })
      .expect(200);

    expect(refreshResponse.body).toEqual({
      success: true,
      message: 'Session refreshed successfully.',
      data: {
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        tokenType: 'Bearer',
        accessTokenExpiresAt: expect.any(String),
        refreshTokenExpiresAt: expect.any(String),
        sessionId: loginResult.sessionId,
        sessionVersion: 1,
        permissionsVersion: 1,
        actorType: 'User',
        issuedAt: expect.any(String),
        serverTime: expect.any(String),
        // ADR-025 delivery: null here because OneSignal Identity Verification
        // is not configured in the test environment (signer fails closed).
        onesignalIdentityToken: null,
      },
      meta: {},
    });

    expect(refreshResponse.body.data.refreshToken).not.toBe(loginResult.refreshToken);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginResult.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: refreshResponse.body.data.refreshToken })
      .expect(200);
  });

  it('compromises token family when a rotated refresh token is reused', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const email = `${TEST_PREFIX}replay@example.com`;
    await prisma.user.create({
      data: {
        id: randomUUID(),
        firstName: 'Replay',
        lastName: 'E2E',
        email,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });

    const loginResult = await login(email);
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginResult.refreshToken })
      .expect(200);

    await prisma.deviceSession.update({
      where: { id: loginResult.sessionId },
      data: { lastUsedAt: new Date(Date.now() - 31_000) },
    });

    const replayResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginResult.refreshToken })
      .expect(401);

    expect(replayResponse.body.code).toBe('AUTH_INVALID_REFRESH_TOKEN');

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotated.body.data.refreshToken })
      .expect(401);

    const session = await prisma.deviceSession.findFirst({
      where: { id: loginResult.sessionId },
      include: { tokenFamily: true },
    });
    expect(session?.revokedAt).not.toBeNull();
    expect(session?.tokenFamily.compromisedAt).not.toBeNull();
  });

  it('returns AUTH_INVALID_REFRESH_TOKEN for malformed body', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: '' })
      .expect(400);

    expect(response.body.success).toBe(false);
  });
});
