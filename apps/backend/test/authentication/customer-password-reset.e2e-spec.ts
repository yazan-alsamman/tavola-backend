import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword } from '../helpers/owner-fixture';
import { VERIFICATION_MESSAGING } from '@modules/authentication/application/ports/verification-messaging.port';
import { RecordingVerificationMessagingPort } from './support/in-memory-registration.dependencies';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'cpr_';
const OLD_PASSWORD = 'SecurePass123!';
const NEW_PASSWORD = 'BrandNewPass1!';

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
 * ADR-022 Decision #16 (Phase 2.23 closure): real-HTTP E2E coverage of the
 * Customer phone/WhatsApp password-recovery flow
 * (START/RESEND/VERIFY/COMPLETE). Same Fonnte-fake override strategy as
 * `customer-registration.e2e-spec.ts` - no real WhatsApp message is ever
 * sent.
 */
describe('Customer password reset (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';
  let messaging: RecordingVerificationMessagingPort;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — customer password reset e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(OLD_PASSWORD);
    messaging = new RecordingVerificationMessagingPort();
    app = await createTestApp([], [{ provide: VERIFICATION_MESSAGING, useValue: messaging }]);
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.customerPasswordResetToken.deleteMany({
        where: { user: { username: { startsWith: TEST_PREFIX } } },
      });
      await prisma.passwordHistory.deleteMany({
        where: { user: { username: { startsWith: TEST_PREFIX } } },
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

  async function seedCustomer(
    username: string,
    phone: { countryCode: string; phoneNumber: string },
  ): Promise<{ userId: string; canonicalPhone: string }> {
    const canonicalPhone = `+963${phone.phoneNumber.replace(/^0/, '')}`;
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

  function codeSentTo(canonicalPhone: string): string {
    const calls = messaging.calls.filter((call) => call.phone === canonicalPhone);
    return calls[calls.length - 1]?.code ?? '';
  }

  async function startReset(phone: { countryCode: string; phoneNumber: string }): Promise<void> {
    await request(app!.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/start')
      .send(phone)
      .expect(200);
  }

  it('START returns the same generic response for a known and an unknown phone (enumeration resistance)', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('enum');
    const knownPhone = syrianPhone();
    await seedCustomer(username, knownPhone);
    const unknownPhone = syrianPhone();

    const knownResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/start')
      .send(knownPhone)
      .expect(200);
    const unknownResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/start')
      .send(unknownPhone)
      .expect(200);

    expect(knownResponse.body.message).toBe(unknownResponse.body.message);
  });

  it('accepts the correct OTP (VERIFY) without changing the password', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('verify');
    const phone = syrianPhone();
    const { canonicalPhone } = await seedCustomer(username, phone);
    await startReset(phone);
    const code = codeSentTo(canonicalPhone);

    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/verify')
      .send({ ...phone, code })
      .expect(200);

    const user = await prisma.user.findUnique({ where: { username } });
    expect(user?.passwordHash).toBe(passwordHash);
  });

  it('rejects an incorrect OTP with AUTH_INVALID_OTP', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('wrongotp');
    const phone = syrianPhone();
    await seedCustomer(username, phone);
    await startReset(phone);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/verify')
      .send({ ...phone, code: '000000' })
      .expect(400);
    expect(response.body.code).toBe('AUTH_INVALID_OTP');
  });

  it('rejects an expired OTP with AUTH_INVALID_OTP (enumeration-resistant - never distinguished from "no active challenge")', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('expired');
    const phone = syrianPhone();
    const { userId } = await seedCustomer(username, phone);
    await startReset(phone);
    const canonicalPhone = `+963${phone.phoneNumber.replace(/^0/, '')}`;
    const code = codeSentTo(canonicalPhone);

    await prisma.customerPasswordResetToken.updateMany({
      where: { userId },
      data: { codeExpiresAt: new Date(Date.now() - 1_000) },
    });

    // ADR-022 Decision #16: `findActiveByUserId` only ever returns
    // unexpired, unconsumed rows - an expired challenge is indistinguishable
    // from "no active challenge at all" here, unlike registration VERIFY
    // (which is not enumeration-sensitive and does surface AUTH_EXPIRED_OTP
    // distinctly - see customer-registration.e2e-spec.ts).
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/verify')
      .send({ ...phone, code })
      .expect(400);
    expect(response.body.code).toBe('AUTH_INVALID_OTP');
  });

  it('enforces the maximum wrong-attempt cap', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('attempts');
    const phone = syrianPhone();
    await seedCustomer(username, phone);
    await startReset(phone);

    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/customer/password-reset/verify')
        .send({ ...phone, code: '000000' });
    }

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/verify')
      .send({ ...phone, code: '000000' })
      .expect(400);
    expect(response.body.code).toBe('AUTH_OTP_ATTEMPTS_EXHAUSTED');
  });

  it('RESEND invalidates the previous OTP', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('resend');
    const phone = syrianPhone();
    const { userId } = await seedCustomer(username, phone);
    await startReset(phone);
    const canonicalPhone = `+963${phone.phoneNumber.replace(/^0/, '')}`;
    const oldCode = codeSentTo(canonicalPhone);

    await prisma.customerPasswordResetToken.updateMany({
      where: { userId },
      data: { updatedAt: new Date(Date.now() - 61_000) },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/resend')
      .send(phone)
      .expect(200);
    const newCode = codeSentTo(canonicalPhone);
    expect(newCode).not.toBe(oldCode);

    const oldRejected = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/verify')
      .send({ ...phone, code: oldCode });
    expect(oldRejected.status).toBe(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/verify')
      .send({ ...phone, code: newCode })
      .expect(200);
  });

  it('rejects replaying an already-consumed challenge after COMPLETE', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('replay');
    const phone = syrianPhone();
    await seedCustomer(username, phone);
    const canonicalPhone = `+963${phone.phoneNumber.replace(/^0/, '')}`;
    await startReset(phone);
    const code = codeSentTo(canonicalPhone);

    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/verify')
      .send({ ...phone, code })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/complete')
      .send({ ...phone, newPassword: NEW_PASSWORD })
      .expect(200);

    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/verify')
      .send({ ...phone, code });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('AUTH_INVALID_OTP');
  });

  it('COMPLETE before VERIFY is rejected', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('notverif');
    const phone = syrianPhone();
    await seedCustomer(username, phone);
    await startReset(phone);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/complete')
      .send({ ...phone, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('AUTH_REGISTRATION_NOT_VERIFIED');
  });

  it('COMPLETE changes the password, revokes sessions, and the old password stops working while the new one works', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('complete');
    const phone = syrianPhone();
    const { canonicalPhone } = await seedCustomer(username, phone);

    const oldLogin = await request(app!.getHttpServer())
      .post('/api/v1/auth/customer/login')
      .send({ ...phone, password: OLD_PASSWORD, deviceType: 'web' })
      .expect(200);
    const sessionId = oldLogin.body.data.sessionId as string;

    await startReset(phone);
    const code = codeSentTo(canonicalPhone);
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/verify')
      .send({ ...phone, code })
      .expect(200);

    const consumedBefore = await prisma.customerPasswordResetToken.findFirst({
      where: { user: { username } },
    });
    expect(consumedBefore?.consumedAt).toBeNull();

    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password-reset/complete')
      .send({ ...phone, newPassword: NEW_PASSWORD })
      .expect(200);

    const consumedAfter = await prisma.customerPasswordResetToken.findFirst({
      where: { user: { username } },
    });
    expect(consumedAfter?.consumedAt).not.toBeNull();

    // Old password no longer works.
    const oldPasswordAttempt = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/login')
      .send({ ...phone, password: OLD_PASSWORD });
    expect(oldPasswordAttempt.status).toBe(401);

    // New password works.
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/login')
      .send({ ...phone, password: NEW_PASSWORD })
      .expect(200);

    // Sessions active before the reset are revoked.
    const session = await prisma.deviceSession.findUnique({ where: { id: sessionId } });
    expect(session?.revokedAt).not.toBeNull();

    // The old password is recorded in PasswordHistory (reuse prevention stays intact).
    const user = await prisma.user.findUnique({ where: { username } });
    const history = await prisma.passwordHistory.findMany({ where: { userId: user!.id } });
    expect(history.length).toBeGreaterThan(0);
  });
});
