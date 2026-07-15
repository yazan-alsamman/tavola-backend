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
const TEST_PREFIX = 'forgot-reset-e2e-';
const OLD_PASSWORD = 'SecurePass123!';
const NEW_PASSWORD = 'BrandNewPass1!';
const opaqueTokenService = new Sha256OpaqueTokenService();

describe('Forgot/reset password flows (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — forgot/reset e2e tests NOT EXECUTED.');
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
    passwordHash = (await hasher.hash(Password.create(OLD_PASSWORD))).value;

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

  async function seedActiveUser(suffix: string) {
    const email = `${TEST_PREFIX}${suffix}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Reset',
        lastName: 'E2E',
        email,
        passwordHash,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });
    return { email, userId };
  }

  async function seedResetToken(userId: string, token: string) {
    await prisma.passwordResetToken.create({
      data: {
        id: randomUUID(),
        userId,
        tokenHash: opaqueTokenService.hash(token),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
  }

  it('FLOW A: forgot password generic response then reset enables new login', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const { email, userId } = await seedActiveUser('flow-a');

    const forgotResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email })
      .expect(200);

    expect(forgotResponse.body.data.message).toContain('eligible account exists');

    // Forgot-password persists only a hash; plaintext delivery is Phase 2.18.
    // Seed a fresh active token after forgot to exercise reset + login on real PostgreSQL.
    const resetToken = `reset-${randomUUID()}`;
    await seedResetToken(userId, resetToken);

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, newPassword: NEW_PASSWORD })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: OLD_PASSWORD, deviceName: 'old', deviceType: 'web' })
      .expect(401);

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: NEW_PASSWORD, deviceName: 'new', deviceType: 'web' })
      .expect(200);

    expect(loginResponse.body.data.accessToken).toEqual(expect.any(String));
  });

  it('FLOW B: unknown email returns the same response shape', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const known = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: `${TEST_PREFIX}known@example.com` })
      .expect(200);

    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@example.com' })
      .expect(200);

    expect(unknown.body.success).toBe(known.body.success);
    expect(unknown.body.message).toBe(known.body.message);
    expect(unknown.body.data.message).toBe(known.body.data.message);
  });

  it('FLOW D: reusing a consumed reset token is rejected', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const { userId } = await seedActiveUser('flow-d');
    const resetToken = `once-${randomUUID()}`;
    await seedResetToken(userId, resetToken);

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, newPassword: NEW_PASSWORD })
      .expect(200);

    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, newPassword: 'AnotherPass123!' })
      .expect(401);

    expect(replay.body.code).toBe('AUTH_INVALID_TOKEN');
  });
});
