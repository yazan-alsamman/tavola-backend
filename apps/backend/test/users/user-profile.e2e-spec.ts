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
const TEST_PREFIX = 'user-profile-e2e-';
const PASSWORD = 'SecurePass123!';
const ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';

const VALID_PATCH_BODY = {
  firstName: 'Valid',
  lastName: 'Valid',
  countryCode: null,
  phoneNumber: null,
  language: 'en',
  preferredCurrency: null,
};

/** Short unique suffix - validator.js's IsEmail enforces RFC 5321's 64-char
 * local-part limit, so the prefix + suffix must stay well under that (see
 * the same precaution in test/tenancy/tenant-context-pipeline.e2e-spec.ts). */
function uniqueId(): string {
  return randomUUID().split('-')[0];
}

describe('GET/PATCH /api/v1/users/me (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — user profile e2e tests NOT EXECUTED.');
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
    overrides: Partial<{ status: UserStatus; emailVerified: boolean; lockedUntil: Date }> = {},
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

    if (Object.keys(overrides).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: overrides });
    }

    return { accessToken, email, userId };
  }

  it("GET returns the caller's own profile with only allowlisted fields", async () => {
    if (!dbAvailable || !app) return;

    const { accessToken, email } = await createAndLoginUser('get-success');

    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data).toMatchObject({
      firstName: 'Original',
      lastName: 'Name',
      email,
      phone: null,
      language: 'en',
      preferredCurrency: null,
    });
    expect(response.body.data.userId).toBeTruthy();
    expect(response.body.data).not.toHaveProperty('passwordHash');
    expect(response.body.data).not.toHaveProperty('password_hash');
    expect(response.body.data).not.toHaveProperty('status');
    expect(response.body.data).not.toHaveProperty('sessionVersion');
    expect(response.body.data).not.toHaveProperty('permissionsVersion');
    expect(JSON.stringify(response.body)).not.toContain(passwordHash);
  });

  it('PATCH updates the profile and persists it', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken, userId } = await createAndLoginUser('patch-success');

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Updated',
        lastName: 'Person',
        countryCode: 'SY',
        phoneNumber: '0900000000',
        language: 'ar',
        preferredCurrency: 'USD',
      })
      .expect(200);

    expect(response.body.data).toMatchObject({
      firstName: 'Updated',
      lastName: 'Person',
      phone: '+963900000000',
      language: 'ar',
      preferredCurrency: 'USD',
    });
    expect(response.body.data).not.toHaveProperty('passwordHash');

    const persisted = await prisma.user.findUnique({ where: { id: userId } });
    expect(persisted?.firstName).toBe('Updated');
    expect(persisted?.language).toBe('ar');
    // Unrelated Authentication fields must survive a profile update untouched.
    expect(persisted?.passwordHash).toBe(passwordHash);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { targetId: userId, action: 'user.profile.updated' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.actorId).toBe(userId);
  });

  it('GET rejects a request with no Authorization header', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('GET rejects a malformed/invalid access token', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('GET rejects a suspended account with 403', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken } = await createAndLoginUser('suspended', {
      status: UserStatus.Suspended,
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    expect(response.body.code).toBe('AUTH_ACCOUNT_SUSPENDED');
  });

  it('GET rejects an expired access token', async () => {
    if (!dbAvailable || !app) return;

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
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);
    expect(response.body.code).toBe('AUTH_EXPIRED_TOKEN');
  });

  it('GET rejects a stale access token after logout-all bumps sessionVersion', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken } = await createAndLoginUser('stale-session');

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('GET ignores any client-supplied identity - the target is always the JWT actor', async () => {
    if (!dbAvailable || !app) return;

    const userA = await createAndLoginUser('spoof-a');
    const userB = await createAndLoginUser('spoof-b');

    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .query({ userId: userB.userId, organizationId: randomUUID() })
      .set('X-User-Id', userB.userId)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(200);

    expect(response.body.data.userId).toBe(userA.userId);
    expect(response.body.data.userId).not.toBe(userB.userId);
  });

  it('PATCH rejects invalid field formats with 400', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken } = await createAndLoginUser('validation');

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Valid',
        lastName: 'Valid',
        countryCode: null,
        phoneNumber: null,
        language: 'english', // invalid - must be 2-letter ISO code
        preferredCurrency: null,
      })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH rejects an invalid currency code with 400', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken } = await createAndLoginUser('validation-currency');

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Valid',
        lastName: 'Valid',
        countryCode: null,
        phoneNumber: null,
        language: 'en',
        preferredCurrency: 'usd', // invalid - must be uppercase 3-letter ISO code
      })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH rejects a malformed phone number with 400', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken } = await createAndLoginUser('validation-phone');

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Valid',
        lastName: 'Valid',
        countryCode: 'SY',
        phoneNumber: 'not-a-phone',
        language: 'en',
        preferredCurrency: null,
      })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH rejects an impossible phone number for the given country with 400', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken } = await createAndLoginUser('validation-phone-impossible');

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Valid',
        lastName: 'Valid',
        countryCode: 'SY',
        phoneNumber: '1',
        language: 'en',
        preferredCurrency: null,
      })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH rejects countryCode supplied without phoneNumber (and vice versa) with 400', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken } = await createAndLoginUser('validation-phone-paired');

    const missingPhoneNumber = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Valid',
        lastName: 'Valid',
        countryCode: 'SY',
        language: 'en',
        preferredCurrency: null,
      })
      .expect(400);
    expect(missingPhoneNumber.body.code).toBe('VALIDATION_ERROR');

    const missingCountryCode = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Valid',
        lastName: 'Valid',
        phoneNumber: '0900000000',
        language: 'en',
        preferredCurrency: null,
      })
      .expect(400);
    expect(missingCountryCode.body.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH rejects a phone number already belonging to another account with 409', async () => {
    if (!dbAvailable || !app) return;

    const owner = await createAndLoginUser('phone-conflict-owner');
    await prisma.user.update({
      where: { id: owner.userId },
      data: { phone: '+963900000042' },
    });
    const { accessToken } = await createAndLoginUser('phone-conflict-claimer');

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Valid',
        lastName: 'Valid',
        countryCode: 'SY',
        phoneNumber: '0900000042',
        language: 'en',
        preferredCurrency: null,
      })
      .expect(409);
    expect(response.body.code).toBe('CONFLICT');
  });

  it('PATCH rejects a canonically-equivalent duplicate phone entered in a different local format with 409', async () => {
    if (!dbAvailable || !app) return;

    const owner = await createAndLoginUser('phone-equiv-owner');
    await prisma.user.update({
      where: { id: owner.userId },
      data: { phone: '+963900000043' },
    });
    const { accessToken } = await createAndLoginUser('phone-equiv-claimer');

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Valid',
        lastName: 'Valid',
        countryCode: 'SY',
        // Same real number as +963900000043, without the trunk zero.
        phoneNumber: '900000043',
        language: 'en',
        preferredCurrency: null,
      })
      .expect(409);
    expect(response.body.code).toBe('CONFLICT');
  });

  it('PATCH allows a user to keep resubmitting their own current phone number', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken, userId } = await createAndLoginUser('phone-keep-own');
    await prisma.user.update({
      where: { id: userId },
      data: { phone: '+963900000044' },
    });

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Valid',
        lastName: 'Valid',
        countryCode: 'SY',
        phoneNumber: '0900000044',
        language: 'en',
        preferredCurrency: null,
      })
      .expect(200);
    expect(response.body.data.phone).toBe('+963900000044');
  });

  it('PATCH is race-safe: two concurrent claims of the same phone by different users leave exactly one winner', async () => {
    if (!dbAvailable || !app) return;

    const userA = await createAndLoginUser('phone-race-a');
    const userB = await createAndLoginUser('phone-race-b');

    const patchWith = (accessToken: string) =>
      request(app!.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          firstName: 'Valid',
          lastName: 'Valid',
          countryCode: 'SY',
          phoneNumber: '0900000045',
          language: 'en',
          preferredCurrency: null,
        });

    const [responseA, responseB] = await Promise.all([
      patchWith(userA.accessToken),
      patchWith(userB.accessToken),
    ]);

    const statuses = [responseA.status, responseB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winnerCount = await prisma.user.count({ where: { phone: '+963900000045' } });
    expect(winnerCount).toBe(1);
  });

  it('PATCH rejects a request with no Authorization header', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .send(VALID_PATCH_BODY)
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('PATCH rejects a malformed/invalid access token', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', 'Bearer not-a-real-token')
      .send(VALID_PATCH_BODY)
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('PATCH rejects an expired access token', async () => {
    if (!dbAvailable || !app) return;

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
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${expiredToken}`)
      .send(VALID_PATCH_BODY)
      .expect(401);
    expect(response.body.code).toBe('AUTH_EXPIRED_TOKEN');
  });

  it('PATCH rejects a stale access token after logout-all bumps sessionVersion', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken } = await createAndLoginUser('patch-stale-session');

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(VALID_PATCH_BODY)
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('PATCH rejects empty required string fields with 400', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken } = await createAndLoginUser('validation-empty');

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...VALID_PATCH_BODY, firstName: '' })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH rejects a missing required field (language) with 400', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken } = await createAndLoginUser('validation-missing');

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Valid',
        lastName: 'Valid',
        countryCode: null,
        phoneNumber: null,
        preferredCurrency: null,
      })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH uses full-replace semantics: omitting optional fields clears them to null', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken, userId } = await createAndLoginUser('full-replace');

    // First set phone/preferredCurrency to non-null values.
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Has',
        lastName: 'Values',
        countryCode: 'SY',
        phoneNumber: '0900000099',
        language: 'en',
        preferredCurrency: 'EUR',
      })
      .expect(200);

    // Re-submitting without phone/preferredCurrency clears them - this is a
    // full-replace endpoint (see UpdateUserProfileRequestDto's own doc
    // comment), not a partial merge, so omitted optional fields are not
    // "kept" - they revert to their nullable default.
    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Cleared', lastName: 'Fields', language: 'en' })
      .expect(200);

    expect(response.body.data.phone).toBeNull();
    expect(response.body.data.preferredCurrency).toBeNull();

    const persisted = await prisma.user.findUnique({ where: { id: userId } });
    expect(persisted?.phone).toBeNull();
    expect(persisted?.preferredCurrency).toBeNull();
  });

  it('PATCH rejects mass-assignment attempts on Authentication/Authorization-owned fields', async () => {
    if (!dbAvailable || !app) return;

    const { accessToken, userId, email } = await createAndLoginUser('mass-assignment');

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        ...VALID_PATCH_BODY,
        id: randomUUID(),
        email: 'attacker@example.com',
        password: 'NewPassword123!',
        passwordHash: 'argon2id$forged',
        sessionVersion: 999,
        permissionsVersion: 999,
        status: 'Active',
        emailVerifiedAt: new Date().toISOString(),
        deletedAt: new Date().toISOString(),
        organizationId: randomUUID(),
        actorType: 'Employee',
        permissions: ['*'],
        refreshToken: 'forged-refresh-token',
        refreshTokenHash: 'forged-refresh-token-hash',
      })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');

    // Belt-and-suspenders: even though the request was rejected outright,
    // confirm none of the forbidden fields could have leaked through.
    const persisted = await prisma.user.findUnique({ where: { id: userId } });
    expect(persisted?.email).toBe(email);
    expect(persisted?.sessionVersion).toBe(1);
    expect(persisted?.status).toBe(UserStatus.Active);
    expect(persisted?.deletedAt).toBeNull();
  });

  it("two different users never see each other's profile - identity comes only from the JWT", async () => {
    if (!dbAvailable || !app) return;

    const userA = await createAndLoginUser('isolation-a');
    const userB = await createAndLoginUser('isolation-b');

    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({
        firstName: 'UserA',
        lastName: 'Only',
        countryCode: null,
        phoneNumber: null,
        language: 'en',
        preferredCurrency: null,
      })
      .expect(200);

    const responseB = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .expect(200);

    expect(responseB.body.data.userId).toBe(userB.userId);
    expect(responseB.body.data.userId).not.toBe(userA.userId);
    expect(responseB.body.data.firstName).not.toBe('UserA');
    expect(responseB.body.data.email).toBe(userB.email);
  });
});
