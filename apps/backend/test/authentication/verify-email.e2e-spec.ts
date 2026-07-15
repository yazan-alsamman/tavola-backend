import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { Sha256OpaqueTokenService } from '@modules/authentication/infrastructure/security/sha256-opaque-token.service';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'verify-email-e2e-';
const opaqueTokenService = new Sha256OpaqueTokenService();

describe('POST /api/v1/auth/verify-email (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn(
        'PostgreSQL not reachable — skipping verify-email e2e tests. Start Docker stack per ENVIRONMENT_SETUP.md.',
      );
      return;
    }

    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.emailVerificationToken.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: TEST_PREFIX } },
      });
    }
    await prisma.$disconnect();
    if (app) {
      await app.close();
    }
  });

  async function seedPendingUser(suffix: string, token: string, expiresAt: Date) {
    const email = `${TEST_PREFIX}${suffix}@example.com`;
    await prisma.user.create({
      data: {
        id: randomUUID(),
        firstName: 'E2E',
        lastName: 'User',
        email,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: UserStatus.Pending,
        emailVerified: false,
        emailVerificationTokens: {
          create: {
            id: randomUUID(),
            tokenHash: opaqueTokenService.hash(token),
            expiresAt,
            consumedAt: null,
          },
        },
      },
    });
    return { email };
  }

  it('verifies email and returns enveloped response when database is available', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const token = `e2e-token-${randomUUID()}`;
    const { email } = await seedPendingUser('success', token, new Date(Date.now() + 3_600_000));

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      message: 'Email verified successfully.',
      data: {
        userId: expect.any(String),
        email,
        status: UserStatus.Active,
      },
      meta: {},
    });

    const user = await prisma.user.findFirst({ where: { email } });
    expect(user?.emailVerified).toBe(true);
    expect(user?.status).toBe(UserStatus.Active);
  });

  it('returns validation error for empty token', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: '' })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns AUTH_EXPIRED_TOKEN for expired token when database is available', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const token = `expired-${randomUUID()}`;
    await seedPendingUser('expired', token, new Date(Date.now() - 1_000));

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(401);

    expect(response.body.code).toBe('AUTH_EXPIRED_TOKEN');
  });

  it('returns AUTH_INVALID_TOKEN for unknown token', async () => {
    if (!dbAvailable || !app) {
      return;
    }

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: 'totally-unknown-token-value' })
      .expect(401);

    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });
});
