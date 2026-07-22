import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { VERIFICATION_MESSAGING } from '@modules/authentication/application/ports/verification-messaging.port';
import { RecordingVerificationMessagingPort } from './support/in-memory-registration.dependencies';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
// Short on purpose - `Username` caps at 30 chars total
// (`^[a-z0-9_]{3,30}$`, no hyphens), and every call site below appends
// `_` + an 8-char random hex suffix on top of this prefix + its own word.
const TEST_PREFIX = 'creg_';
const PASSWORD = 'SecurePass123!';

function randomDigits(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(Math.random() * 10).toString();
  }
  return out;
}

/**
 * Syrian (+963) mobile number, unique per call - a valid Syrian mobile
 * national number is 9 significant digits (9 + 8 more); with the national
 * trunk zero that's "09" + 8 digits = 10 characters, matching the
 * already-established `0912345678` shape used elsewhere in this repo.
 */
function syrianPhone(): { countryCode: string; phoneNumber: string } {
  return { countryCode: 'SY', phoneNumber: `09${randomDigits(8)}` };
}

/**
 * UAE (+971) mobile number, unique per call - proves the frozen
 * country-code rule never substitutes +963. A valid UAE mobile national
 * number is 9 significant digits (5 + 8 more); with the trunk zero that's
 * "05" + 8 digits = 10 characters, matching `0501234567`'s shape.
 */
function uaePhone(): { countryCode: string; phoneNumber: string } {
  return { countryCode: 'AE', phoneNumber: `05${randomDigits(8)}` };
}

function uniqueUsername(suffix: string): string {
  return `${TEST_PREFIX}${suffix}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

/**
 * ADR-022 (Phase 2.23 closure): comprehensive real-HTTP E2E coverage of the
 * Customer registration lifecycle (START/RESEND/VERIFY/COMPLETE). The real
 * `VerificationMessagingPort` (Fonnte) is overridden with
 * `RecordingVerificationMessagingPort` for the whole app instance - no real
 * WhatsApp message is ever sent by this suite; the plaintext OTP is read
 * back from the fake's in-memory `calls` array, exactly as a real WhatsApp
 * recipient would read it from their phone.
 */
describe('Customer registration (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let messaging: RecordingVerificationMessagingPort;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — customer registration e2e tests NOT EXECUTED.');
      return;
    }

    messaging = new RecordingVerificationMessagingPort();
    app = await createTestApp([], [{ provide: VERIFICATION_MESSAGING, useValue: messaging }]);
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.pendingCustomerRegistration.deleteMany({
        where: { username: { startsWith: TEST_PREFIX } },
      });
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

  const COUNTRY_DIAL_CODE: Record<string, string> = { SY: '963', AE: '971' };

  function canonicalOf(phone: { countryCode: string; phoneNumber: string }): string {
    return `+${COUNTRY_DIAL_CODE[phone.countryCode]}${phone.phoneNumber.replace(/^0/, '')}`;
  }

  function codeSentTo(phone: { countryCode: string; phoneNumber: string }): string {
    const canonical = canonicalOf(phone);
    const calls = messaging.calls.filter((call) => call.phone === canonical);
    return calls[calls.length - 1]?.code ?? '';
  }

  async function start(
    username: string,
    phone: { countryCode: string; phoneNumber: string },
  ): Promise<void> {
    await request(app!.getHttpServer())
      .post('/api/v1/auth/customer/register/start')
      .send({ username, ...phone })
      .expect(200);
  }

  it('START creates a pending registration only - no User exists before COMPLETE', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('start');
    const phone = syrianPhone();
    await start(username, phone);

    const pending = await prisma.pendingCustomerRegistration.findFirst({ where: { username } });
    expect(pending).not.toBeNull();
    expect(pending?.verifiedAt).toBeNull();
    expect(pending?.consumedAt).toBeNull();

    const user = await prisma.user.findFirst({ where: { username } });
    expect(user).toBeNull();
  });

  it('never persists the OTP plaintext - the stored codeHash never equals or contains the plaintext code', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('plaintext');
    const phone = syrianPhone();
    await start(username, phone);

    const code = codeSentTo(phone);
    expect(code).toMatch(/^\d{6}$/);

    const pending = await prisma.pendingCustomerRegistration.findFirst({ where: { username } });
    expect(pending?.codeHash).not.toBe(code);
    expect(pending?.codeHash).not.toContain(code);
    expect(pending?.codeHash.length).toBeGreaterThan(6);
  });

  it('accepts the correct OTP and marks the pending registration verified', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('verify_ok');
    const phone = syrianPhone();
    await start(username, phone);
    const code = codeSentTo(phone);

    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...phone, code })
      .expect(200);

    const pending = await prisma.pendingCustomerRegistration.findFirst({ where: { username } });
    expect(pending?.verifiedAt).not.toBeNull();
  });

  it('rejects a wrong OTP with AUTH_INVALID_OTP', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('verify_wrong');
    const phone = syrianPhone();
    await start(username, phone);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...phone, code: '000000' })
      .expect(400);
    expect(response.body.code).toBe('AUTH_INVALID_OTP');

    const pending = await prisma.pendingCustomerRegistration.findFirst({ where: { username } });
    expect(pending?.verifiedAt).toBeNull();
    expect(pending?.incorrectAttemptCount).toBe(1);
  });

  it('rejects an expired OTP with AUTH_EXPIRED_OTP', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('expired');
    const phone = syrianPhone();
    await start(username, phone);
    const code = codeSentTo(phone);

    await prisma.pendingCustomerRegistration.updateMany({
      where: { username },
      data: { codeExpiresAt: new Date(Date.now() - 1_000) },
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...phone, code })
      .expect(400);
    expect(response.body.code).toBe('AUTH_EXPIRED_OTP');
  });

  it('enforces the maximum wrong-attempt cap (AUTH_OTP_ATTEMPTS_EXHAUSTED)', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('attempts');
    const phone = syrianPhone();
    await start(username, phone);

    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/customer/register/verify')
        .send({ ...phone, code: '000000' });
    }

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...phone, code: '000000' })
      .expect(400);
    expect(response.body.code).toBe('AUTH_OTP_ATTEMPTS_EXHAUSTED');
  });

  it('RESEND invalidates the previous OTP - the old code no longer verifies, only the new one does', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('resend');
    const phone = syrianPhone();
    await start(username, phone);
    const oldCode = codeSentTo(phone);

    // Backdate updatedAt so the resend cooldown has already elapsed.
    await prisma.pendingCustomerRegistration.updateMany({
      where: { username },
      data: { updatedAt: new Date(Date.now() - 61_000) },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/resend')
      .send(phone)
      .expect(200);
    const newCode = codeSentTo(phone);
    expect(newCode).not.toBe(oldCode);

    const oldRejected = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...phone, code: oldCode });
    expect(oldRejected.status).toBe(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...phone, code: newCode })
      .expect(200);
  });

  it('rejects a resend attempted before the cooldown elapses', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('resend_cd');
    const phone = syrianPhone();
    await start(username, phone);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/resend')
      .send(phone);
    expect(response.status).toBe(429);
    expect(response.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('rejects VERIFY replay - a verified-then-consumed code cannot verify again after COMPLETE', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('replay');
    const phone = syrianPhone();
    await start(username, phone);
    const code = codeSentTo(phone);

    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...phone, code })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/complete')
      .send({ ...phone, password: PASSWORD })
      .expect(201);

    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...phone, code });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('AUTH_INVALID_OTP');
  });

  it('COMPLETE is single-use - a second COMPLETE for the same phone fails', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('single_use');
    const phone = syrianPhone();
    await start(username, phone);
    const code = codeSentTo(phone);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...phone, code })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/complete')
      .send({ ...phone, password: PASSWORD })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/complete')
      .send({ ...phone, password: 'AnotherSecurePass1!' });
    expect(second.status).toBe(400);
    expect(second.body.code).toBe('AUTH_INVALID_OTP');

    const userCount = await prisma.user.count({ where: { username } });
    expect(userCount).toBe(1);
  });

  it('COMPLETE before VERIFY is rejected with AUTH_REGISTRATION_NOT_VERIFIED', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('not_verified');
    const phone = syrianPhone();
    await start(username, phone);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/complete')
      .send({ ...phone, password: PASSWORD });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('AUTH_REGISTRATION_NOT_VERIFIED');
  });

  it('repeated START for the same phone restarts (reissues) rather than creating a parallel pending registration', async () => {
    if (!dbAvailable || !app) return;

    const usernameA = uniqueUsername('restart_a');
    const usernameB = uniqueUsername('restart_b');
    const phone = syrianPhone();

    await start(usernameA, phone);
    await start(usernameB, phone);

    const rows = await prisma.pendingCustomerRegistration.findMany({
      where: { phone: canonicalOf(phone) },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].username).toBe(usernameB);
  });

  it('rejects a duplicate canonical phone at COMPLETE-time (already a real Customer)', async () => {
    if (!dbAvailable || !app) return;

    const firstUsername = uniqueUsername('dup_ph1');
    const phone = syrianPhone();
    await start(firstUsername, phone);
    const firstCode = codeSentTo(phone);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...phone, code: firstCode })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/complete')
      .send({ ...phone, password: PASSWORD })
      .expect(201);

    const secondUsername = uniqueUsername('dup_ph2');
    const startAgain = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/start')
      .send({ username: secondUsername, ...phone });
    expect(startAgain.status).toBe(409);
    expect(startAgain.body.code).toBe('CONFLICT');
  });

  it('rejects a duplicate username at START-time (already a real Customer)', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('dup_user');
    const phoneA = syrianPhone();
    await start(username, phoneA);
    const codeA = codeSentTo(phoneA);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...phoneA, code: codeA })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/complete')
      .send({ ...phoneA, password: PASSWORD })
      .expect(201);

    const phoneB = syrianPhone();
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/start')
      .send({ username, ...phoneB });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CONFLICT');
  });

  it('rejects a case-insensitive duplicate username', async () => {
    if (!dbAvailable || !app) return;

    const baseUsername = uniqueUsername('case');
    const phoneA = syrianPhone();
    await start(baseUsername, phoneA);
    const codeA = codeSentTo(phoneA);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...phoneA, code: codeA })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/complete')
      .send({ ...phoneA, password: PASSWORD })
      .expect(201);

    const phoneB = syrianPhone();
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/start')
      .send({ username: baseUsername.toUpperCase(), ...phoneB });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CONFLICT');
  });

  it('successful COMPLETE creates exactly one Customer User with username, canonical E.164 phone, hashed password, and email = NULL', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('final');
    const phone = syrianPhone();
    await start(username, phone);
    const code = codeSentTo(phone);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...phone, code })
      .expect(200);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/complete')
      .send({ ...phone, password: PASSWORD })
      .expect(201);

    expect(response.body.data.username).toBe(username);
    expect(response.body.data.phone).toBe(canonicalOf(phone));

    const users = await prisma.user.findMany({ where: { username } });
    expect(users).toHaveLength(1);
    const user = users[0];
    expect(user.email).toBeNull();
    expect(user.phone).toBe(canonicalOf(phone));
    expect(user.passwordHash).not.toBe(PASSWORD);
    expect(user.passwordHash.startsWith('$argon2')).toBe(true);
    expect(user.status).toBe('Active');

    // The pending registration is consumed/removed, not retained.
    const pending = await prisma.pendingCustomerRegistration.findFirst({ where: { username } });
    expect(pending).toBeNull();
  });

  it('supports an international (+971 UAE) Customer end-to-end, never substituting +963', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('uae');
    const phone = uaePhone();
    await start(username, phone);
    const code = codeSentTo(phone);
    expect(code).toMatch(/^\d{6}$/);

    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...phone, code })
      .expect(200);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/complete')
      .send({ ...phone, password: PASSWORD })
      .expect(201);

    expect(response.body.data.phone.startsWith('+971')).toBe(true);
    expect(response.body.data.phone.startsWith('+963')).toBe(false);

    const user = await prisma.user.findFirst({ where: { username } });
    expect(user?.phone?.startsWith('+971')).toBe(true);
  });

  it('normalizes equivalent local formatting (with/without trunk zero) to the identical canonical E.164 identity', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('equiv');
    const rawSuffix = `9${randomDigits(8)}`;
    const withTrunkZero = { countryCode: 'SY', phoneNumber: `0${rawSuffix}` };
    const withoutTrunkZero = { countryCode: 'SY', phoneNumber: rawSuffix };

    await start(username, withTrunkZero);
    const code = codeSentTo(withTrunkZero);

    // VERIFY submitted using the OTHER equivalent raw format must still
    // resolve to the same canonical phone and succeed.
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...withoutTrunkZero, code })
      .expect(200);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/complete')
      .send({ ...withoutTrunkZero, password: PASSWORD })
      .expect(201);

    expect(response.body.data.phone).toBe(`+963${rawSuffix}`);
  });
});
