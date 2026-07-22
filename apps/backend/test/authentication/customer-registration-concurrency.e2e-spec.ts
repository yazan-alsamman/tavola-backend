import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { VERIFICATION_MESSAGING } from '@modules/authentication/application/ports/verification-messaging.port';
import { RecordingVerificationMessagingPort } from './support/in-memory-registration.dependencies';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'crc_';
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

function uniqueUsername(suffix: string): string {
  return `${TEST_PREFIX}${suffix}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

/**
 * ADR-022 (Phase 2.23 closure): real-PostgreSQL, real-HTTP concurrency
 * guarantees for the Customer registration lifecycle - genuine
 * `Promise.all` bursts against the real running app, not sequential calls
 * or in-memory fakes. Complements
 * `prisma-customer-phone-auth.integration-spec.ts` (which proves the
 * *sequential* repeated-START restart semantics at the repository level)
 * with the *simultaneous* case, and adds concurrent-COMPLETE coverage that
 * did not exist before.
 */
describe('Customer registration concurrency guarantees (e2e, real PostgreSQL)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let messaging: RecordingVerificationMessagingPort;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn(
        'PostgreSQL not reachable — customer registration concurrency tests NOT EXECUTED.',
      );
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
      await prisma.user.deleteMany({ where: { username: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  it('allows exactly one active pending registration to survive a concurrent START burst for the same canonical phone', async () => {
    if (!dbAvailable || !app) return;

    const phone = syrianPhone();
    const canonicalPhone = `+963${phone.phoneNumber.replace(/^0/, '')}`;
    const BURST_SIZE = 10;

    const responses = await Promise.all(
      Array.from({ length: BURST_SIZE }, (_, i) =>
        request(app!.getHttpServer())
          .post('/api/v1/auth/customer/register/start')
          .send({ username: uniqueUsername(`burst${i}`), ...phone }),
      ),
    );

    // Every concurrent request either succeeds (restarts the row) or fails
    // on a genuine, expected race (e.g. a username-collision re-check) -
    // never a 5xx crash.
    for (const response of responses) {
      expect(response.status).toBeLessThan(500);
    }

    const rows = await prisma.pendingCustomerRegistration.findMany({
      where: { phone: canonicalPhone },
    });
    expect(rows).toHaveLength(1);
  });

  it('allows exactly one Customer User to survive a concurrent COMPLETE burst for the same verified phone', async () => {
    if (!dbAvailable || !app) return;

    const username = uniqueUsername('complete');
    const phone = syrianPhone();
    const canonicalPhone = `+963${phone.phoneNumber.replace(/^0/, '')}`;

    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/start')
      .send({ username, ...phone })
      .expect(200);
    const code = messaging.calls[messaging.calls.length - 1].code;
    await request(app.getHttpServer())
      .post('/api/v1/auth/customer/register/verify')
      .send({ ...phone, code })
      .expect(200);

    const BURST_SIZE = 10;
    const responses = await Promise.all(
      Array.from({ length: BURST_SIZE }, () =>
        request(app!.getHttpServer())
          .post('/api/v1/auth/customer/register/complete')
          .send({ ...phone, password: PASSWORD }),
      ),
    );

    const succeeded = responses.filter((response) => response.status === 201);
    const rejected = responses.filter((response) => response.status !== 201);
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(BURST_SIZE - 1);
    for (const response of rejected) {
      expect(response.status).toBeLessThan(500);
    }

    const users = await prisma.user.findMany({ where: { phone: canonicalPhone } });
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe(username);
  });
});
