import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'clog_';
const PASSWORD = 'SecurePass123!';

function randomDigits(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(Math.random() * 10).toString();
  }
  return out;
}

function syrianPhone(): { countryCode: string; phoneNumber: string } {
  return { countryCode: 'SY', phoneNumber: `09${randomDigits(8)}` };
}

function uaePhone(): { countryCode: string; phoneNumber: string } {
  return { countryCode: 'AE', phoneNumber: `05${randomDigits(8)}` };
}

function uniqueUsername(suffix: string): string {
  return `${TEST_PREFIX}${suffix}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

/**
 * ADR-022 §"Customer Login" (Phase 2.23 closure): real-HTTP E2E coverage of
 * `POST /auth/customer/login` and the session mechanics it shares
 * unchanged with the Owner/staff login (DeviceSession, TokenFamily,
 * refresh rotation, reuse detection, logout) - proven once here for the
 * Customer contract specifically, not re-deriving the whole mechanic
 * (already covered generically by refresh.e2e-spec.ts/logout.e2e-spec.ts).
 */
describe('Customer login (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — customer login e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.deviceSession.deleteMany({
        where: { user: { username: { startsWith: TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
        where: { user: { username: { startsWith: TEST_PREFIX } } },
      });
      await prisma.user.deleteMany({ where: { username: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function seedCustomer(
    username: string,
    phone: { countryCode: string; phoneNumber: string },
    dialCode: string,
  ): Promise<{ userId: string; canonicalPhone: string }> {
    const canonicalPhone = `+${dialCode}${phone.phoneNumber.replace(/^0/, '')}`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: null,
        lastName: null,
        email: null,
        username,
        phone: canonicalPhone,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: false,
      },
    });
    return { userId, canonicalPhone };
  }

  async function login(phone: { countryCode: string; phoneNumber: string }) {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/auth/customer/login')
      .send({ ...phone, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    return response.body.data as {
      accessToken: string;
      refreshToken: string;
      sessionId: string;
      user: { userId: string; username: string; phone: string };
    };
  }

  it('logs in successfully with phone + password (Syrian number)', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('login');
    const phone = syrianPhone();
    const { userId, canonicalPhone } = await seedCustomer(username, phone, '963');

    const result = await login(phone);
    expect(result.user.userId).toBe(userId);
    expect(result.user.username).toBe(username);
    expect(result.user.phone).toBe(canonicalPhone);
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.sessionId).toBeDefined();
  });

  it('logs in successfully with an international (+971 UAE) number', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('uae');
    const phone = uaePhone();
    await seedCustomer(username, phone, '971');

    const result = await login(phone);
    expect(result.user.phone.startsWith('+971')).toBe(true);
  });

  it('rejects a wrong password with AUTH_INVALID_CREDENTIALS', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('wrongpw');
    const phone = syrianPhone();
    await seedCustomer(username, phone, '963');

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/login')
      .send({ ...phone, password: 'WrongPass123!' })
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('rejects an unknown phone with the same AUTH_INVALID_CREDENTIALS (no enumeration)', async () => {
    if (!dbAvailable || !app) return;

    const phone = syrianPhone();
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/login')
      .send({ ...phone, password: PASSWORD })
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('logs in successfully using an equivalent local phone format (with/without trunk zero)', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('equivfmt');
    const rawSuffix = `9${randomDigits(8)}`;
    const withTrunkZero = { countryCode: 'SY', phoneNumber: `0${rawSuffix}` };
    const withoutTrunkZero = { countryCode: 'SY', phoneNumber: rawSuffix };
    await seedCustomer(username, withTrunkZero, '963');

    const result = await login(withoutTrunkZero);
    expect(result.user.username).toBe(username);
  });

  it('creates a real session, refreshes it, detects refresh-token reuse, and logs out', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('session');
    const phone = syrianPhone();
    await seedCustomer(username, phone, '963');

    const loginResult = await login(phone);

    const deviceSession = await prisma.deviceSession.findUnique({
      where: { id: loginResult.sessionId },
    });
    expect(deviceSession).not.toBeNull();

    const refreshResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginResult.refreshToken })
      .expect(200);
    const rotatedRefreshToken = refreshResponse.body.data.refreshToken as string;

    // Escape the concurrent-refresh grace window (same established pattern
    // as refresh.e2e-spec.ts) so presenting the old token is unambiguous replay.
    await prisma.deviceSession.update({
      where: { id: loginResult.sessionId },
      data: { lastUsedAt: new Date(Date.now() - 31_000) },
    });

    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginResult.refreshToken })
      .expect(401);
    expect(replay.body.code).toBe('AUTH_INVALID_REFRESH_TOKEN');

    // Reuse detection compromises the whole token family - even the
    // legitimately rotated token must now be rejected.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotatedRefreshToken })
      .expect(401);

    // A fresh login + logout still works normally afterward.
    const secondLogin = await login(phone);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${secondLogin.accessToken}`)
      .expect(204);

    const revokedSession = await prisma.deviceSession.findUnique({
      where: { id: secondLogin.sessionId },
    });
    expect(revokedSession?.revokedAt).not.toBeNull();
  });

  it('never regresses Owner/staff login on the unrelated /auth/login route', async () => {
    if (!dbAvailable || !app) return;

    // Sanity check only - full Owner login coverage lives in login.e2e-spec.ts.
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `${TEST_PREFIX}nonexistent-owner@example.com`, password: PASSWORD });
    expect(response.status).toBe(401);
  });
});
