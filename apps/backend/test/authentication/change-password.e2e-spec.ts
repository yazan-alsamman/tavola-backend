import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { createTestApp } from '../helpers/test-app.factory';
import { Argon2PasswordHasher } from '@modules/authentication/infrastructure/security/argon2-password-hasher';
import { Sha256OpaqueTokenService } from '@modules/authentication/infrastructure/security/sha256-opaque-token.service';
import { Password } from '@shared/domain/value-objects/password.vo';
import authConfig from '@config/auth.config';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'change-password-e2e-';
const CURRENT_PASSWORD = 'SecurePass123!';
const NEW_PASSWORD = 'BrandNewPass1!';
const opaqueTokenService = new Sha256OpaqueTokenService();

describe('POST /api/v1/auth/change-password (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — change-password e2e tests NOT EXECUTED.');
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
    passwordHash = (await hasher.hash(Password.create(CURRENT_PASSWORD))).value;

    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.passwordResetToken.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.passwordHistory.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
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

  async function login(email: string, deviceName: string) {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: CURRENT_PASSWORD, deviceName, deviceType: 'web' })
      .expect(200);
    return response.body.data as {
      accessToken: string;
      refreshToken: string;
      sessionId: string;
      sessionVersion: number;
    };
  }

  it('FLOW A: authenticated change password then new login succeeds', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const email = `${TEST_PREFIX}flow-a@example.com`;
    await prisma.user.create({
      data: {
        id: randomUUID(),
        firstName: 'Change',
        lastName: 'E2E',
        email,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });

    const loginResult = await login(email, 'device-a');
    const changeResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${loginResult.accessToken}`)
      .send({ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);

    expect(changeResponse.body.data.sessionVersion).toBeGreaterThan(loginResult.sessionVersion);

    // Blocker #3 fix: change-password bumps sessionVersion, which would
    // otherwise immediately invalidate the very access token used to make
    // this call (SessionVersionGuard compares against the live DB value).
    // change-password now returns a fresh access token so the caller's
    // session keeps working without a mandatory /auth/refresh round trip.
    const newAccessToken = changeResponse.body.data.accessToken as string;
    expect(newAccessToken).toBeTruthy();
    expect(newAccessToken).not.toBe(loginResult.accessToken);

    await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${loginResult.accessToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${newAccessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: CURRENT_PASSWORD, deviceName: 'old', deviceType: 'web' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: NEW_PASSWORD, deviceName: 'new', deviceType: 'web' })
      .expect(200);
  });

  it('FLOW D: wrong current password is rejected without changing password', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const email = `${TEST_PREFIX}flow-d@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Wrong',
        lastName: 'Pass',
        email,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });

    const loginResult = await login(email, 'device-d');
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${loginResult.accessToken}`)
      .send({ currentPassword: 'WrongPass123!', newPassword: NEW_PASSWORD })
      .expect(401);

    expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.passwordHash).toBe(passwordHash);
  });

  it('FLOW C: change password invalidates active reset token', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const email = `${TEST_PREFIX}flow-c@example.com`;
    const userId = randomUUID();
    const resetToken = `reset-${randomUUID()}`;
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Reset',
        lastName: 'Invalidate',
        email,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
        passwordResetTokens: {
          create: {
            id: randomUUID(),
            tokenHash: opaqueTokenService.hash(resetToken),
            expiresAt: new Date(Date.now() + 3_600_000),
          },
        },
      },
    });

    const loginResult = await login(email, 'device-c');
    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${loginResult.accessToken}`)
      .send({ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);

    const resetResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, newPassword: 'AnotherPass123!' })
      .expect(401);

    expect(resetResponse.body.code).toBe('AUTH_INVALID_TOKEN');
  });
});
