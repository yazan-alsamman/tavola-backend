import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword } from '../helpers/owner-fixture';
import { VERIFICATION_MESSAGING } from '@modules/authentication/application/ports/verification-messaging.port';
import { RecordingVerificationMessagingPort } from './support/in-memory-registration.dependencies';
import {
  isDatabaseReachable,
  isRedisReachable,
  resolveTestRedisUrl,
  skipUnlessDatabaseAvailable,
} from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'crl_';
const PASSWORD = 'SecurePass123!';

// Small, fast-testable overrides for THIS file's own isolated app instance
// only (mirrors rate-limit.e2e-spec.ts's own established pattern) - the
// real production defaults (5/hour, 10/15min) would make this suite
// impractically slow to exercise the actual 429 boundary.
const OVERRIDES: Record<string, string> = {
  RATE_LIMIT_CUSTOMER_REGISTER_SEND_MAX: '3',
  RATE_LIMIT_CUSTOMER_REGISTER_SEND_WINDOW_SECONDS: '3600',
  RATE_LIMIT_CUSTOMER_REGISTER_VERIFY_MAX: '3',
  RATE_LIMIT_CUSTOMER_REGISTER_VERIFY_WINDOW_SECONDS: '900',
  RATE_LIMIT_CUSTOMER_PASSWORD_RESET_SEND_MAX: '3',
  RATE_LIMIT_CUSTOMER_PASSWORD_RESET_SEND_WINDOW_SECONDS: '3600',
  RATE_LIMIT_CUSTOMER_PASSWORD_RESET_VERIFY_MAX: '3',
  RATE_LIMIT_CUSTOMER_PASSWORD_RESET_VERIFY_WINDOW_SECONDS: '900',
};
const RESTORE: Record<string, string> = {
  RATE_LIMIT_CUSTOMER_REGISTER_SEND_MAX: '5',
  RATE_LIMIT_CUSTOMER_REGISTER_VERIFY_MAX: '10',
  RATE_LIMIT_CUSTOMER_PASSWORD_RESET_SEND_MAX: '5',
  RATE_LIMIT_CUSTOMER_PASSWORD_RESET_VERIFY_MAX: '10',
};

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

function uniqueUsername(suffix: string): string {
  return `${TEST_PREFIX}${suffix}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

/**
 * ADR-022 (Phase 2.23 closure): real-Redis verification of the four new
 * named rate-limit policies this phase introduced
 * (customerRegisterSend/Verify, customerPasswordResetSend/Verify) - a real
 * HTTP route, a real `RateLimitGuard`, and real Redis (via
 * `RedisSlidingWindowRateLimiter`), not a mocked guard unit test.
 */
describe('Customer registration/password-reset rate limits (e2e, real Redis)', () => {
  let app: INestApplication | undefined;
  let ready = false;
  let passwordHash = 'argon2id$test';
  let messaging: RecordingVerificationMessagingPort;

  beforeAll(async () => {
    const dbAvailable = await isDatabaseReachable();
    const redisAvailable = await isRedisReachable(resolveTestRedisUrl());
    ready = dbAvailable && redisAvailable;

    if (skipUnlessDatabaseAvailable(ready)) {
      console.warn(
        'PostgreSQL and/or Redis not reachable — customer rate-limit e2e tests NOT EXECUTED.',
      );
      return;
    }

    for (const [key, value] of Object.entries(OVERRIDES)) {
      process.env[key] = value;
    }

    passwordHash = await hashTestPassword(PASSWORD);
    messaging = new RecordingVerificationMessagingPort();
    app = await createTestApp([], [{ provide: VERIFICATION_MESSAGING, useValue: messaging }]);
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(RESTORE)) {
      process.env[key] = value;
    }
    if (ready) {
      await prisma.pendingCustomerRegistration.deleteMany({
        where: { username: { startsWith: TEST_PREFIX } },
      });
      await prisma.customerPasswordResetToken.deleteMany({
        where: { user: { username: { startsWith: TEST_PREFIX } } },
      });
      await prisma.user.deleteMany({ where: { username: { startsWith: TEST_PREFIX } } });
    }
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it('blocks customerRegisterSend with 429 once the per-phone limit is exceeded', async () => {
    if (!ready || !app) return;

    const phone = syrianPhone();
    for (let i = 0; i < 3; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/customer/register/start')
        .send({ username: uniqueUsername(`send${i}`), ...phone });
      expect(response.status).toBe(200);
    }

    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/start')
      .send({ username: uniqueUsername('sendover'), ...phone });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('shares the SAME customerRegisterSend bucket across equivalent phone formats (bypass resistance)', async () => {
    if (!ready || !app) return;

    const rawSuffix = `9${randomDigits(8)}`;
    const withTrunkZero = { countryCode: 'SY', phoneNumber: `0${rawSuffix}` };
    const withoutTrunkZero = { countryCode: 'sy', phoneNumber: rawSuffix };

    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/start')
      .send({ username: uniqueUsername('fmt0'), ...withTrunkZero })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/start')
      .send({ username: uniqueUsername('fmt1'), ...withoutTrunkZero })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/start')
      .send({ username: uniqueUsername('fmt2'), ...withTrunkZero })
      .expect(200);

    // A 4th call, regardless of which equivalent raw format, must already
    // be blocked - proving both formats share one bucket, not two.
    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/start')
      .send({ username: uniqueUsername('fmt3'), ...withoutTrunkZero });
    expect(blocked.status).toBe(429);
  });

  it('keeps independent phones fully isolated - a different phone is unaffected', async () => {
    if (!ready || !app) return;

    const exhaustedPhone = syrianPhone();
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/customer/register/start')
        .send({ username: uniqueUsername(`iso${i}`), ...exhaustedPhone });
    }
    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/start')
      .send({ username: uniqueUsername('isoover'), ...exhaustedPhone });
    expect(blocked.status).toBe(429);

    const freshPhone = syrianPhone();
    const allowed = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/start')
      .send({ username: uniqueUsername('isofresh'), ...freshPhone });
    expect(allowed.status).toBe(200);
  });

  it('blocks customerRegisterVerify with 429 once the per-phone/IP limit is exceeded', async () => {
    if (!ready || !app) return;

    const phone = syrianPhone();
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/start')
      .send({ username: uniqueUsername('verify'), ...phone })
      .expect(200);

    for (let i = 0; i < 3; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/customer/register/verify')
        .send({ ...phone, code: '000000' });
      expect(response.status).toBe(400);
    }

    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...phone, code: '000000' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('blocks customerPasswordResetSend with 429 once the per-phone limit is exceeded', async () => {
    if (!ready || !app) return;

    const username = uniqueUsername('pwstart');
    const phone = syrianPhone();
    await prisma.user.create({
      data: {
        id: randomUUID(),
        firstName: null,
        lastName: null,
        email: null,
        username,
        phone: `+963${phone.phoneNumber.replace(/^0/, '')}`,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: false,
      },
    });

    for (let i = 0; i < 3; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/customer/password-reset/start')
        .send(phone);
      expect(response.status).toBe(200);
    }

    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/start')
      .send(phone);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('blocks customerPasswordResetVerify with 429 once the per-phone/IP limit is exceeded', async () => {
    if (!ready || !app) return;

    const username = uniqueUsername('pwverify');
    const phone = syrianPhone();
    await prisma.user.create({
      data: {
        id: randomUUID(),
        firstName: null,
        lastName: null,
        email: null,
        username,
        phone: `+963${phone.phoneNumber.replace(/^0/, '')}`,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: false,
      },
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/start')
      .send(phone)
      .expect(200);

    for (let i = 0; i < 3; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/customer/password-reset/verify')
        .send({ ...phone, code: '000000' });
      expect(response.status).toBe(400);
    }

    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/verify')
      .send({ ...phone, code: '000000' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
