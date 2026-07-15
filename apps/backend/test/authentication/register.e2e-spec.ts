import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'register-e2e-';

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intent: 'owner',
    email: `${TEST_PREFIX}${randomUUID()}@example.com`,
    password: 'SecurePass123!',
    firstName: 'Jane',
    lastName: 'Doe',
    organizationName: `${TEST_PREFIX}Org ${randomUUID()}`,
    consents: { termsOfService: true, privacyPolicy: true },
    ...overrides,
  };
}

describe('POST /api/v1/auth/register (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn(
        'PostgreSQL not reachable — register e2e tests NOT EXECUTED. Start Docker stack per ENVIRONMENT_SETUP.md.',
      );
      return;
    }

    process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';
    process.env.ARGON2_MEMORY_COST = '4096';
    process.env.ARGON2_TIME_COST = '1';

    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.userConsent.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.emailVerificationToken.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organizationMember.deleteMany({
        where: { organization: { slug: { contains: 'register-e2e' } } },
      });
      await prisma.organization.deleteMany({ where: { slug: { contains: 'register-e2e' } } });
      await prisma.auditLog.deleteMany({ where: { action: 'auth.register.success' } });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  it('registers a new owner: 201, documented response shape only, full DB side effects, audit + event', async () => {
    if (!dbAvailable || !app) return;

    const payload = validPayload();

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(payload)
      .expect(201);

    expect(response.body).toEqual({
      success: true,
      message: 'Registration successful. Please verify your email.',
      data: {
        userId: expect.any(String),
        email: (payload.email as string).toLowerCase(),
        status: 'Pending',
      },
      meta: {},
    });

    // Response must NOT leak fields the documented contract doesn't include.
    expect(response.body.data.organizationId).toBeUndefined();
    expect(response.body.data.organizationSlug).toBeUndefined();
    expect(response.body.data.organizationName).toBeUndefined();
    expect(response.body.data.passwordHash).toBeUndefined();

    const userId = response.body.data.userId as string;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user).not.toBeNull();
    expect(user?.status).toBe('Pending');
    expect(user?.emailVerified).toBe(false);
    // Never persisted in plaintext, never echoed back.
    expect(user?.passwordHash).not.toBe(payload.password);

    const membership = await prisma.organizationMember.findFirst({ where: { userId } });
    expect(membership).not.toBeNull();
    expect(membership?.role).toBe('Owner');

    const organization = await prisma.organization.findUnique({
      where: { id: membership!.organizationId },
    });
    expect(organization?.name).toBe(payload.organizationName);

    const consents = await prisma.userConsent.findMany({ where: { userId } });
    expect(consents.map((c) => c.consentType).sort()).toEqual(
      ['PrivacyPolicy', 'TermsOfService'].sort(),
    );

    const verificationToken = await prisma.emailVerificationToken.findFirst({ where: { userId } });
    expect(verificationToken).not.toBeNull();
    expect(verificationToken?.consumedAt).toBeNull();

    // Audit integration: UserRegisteredEvent -> AuditingEventPublisher ->
    // AuditLog, proving both the domain event fired and audit consumed it,
    // without any new audit code added this phase.
    const auditRow = await prisma.auditLog.findFirst({
      where: { actorId: userId, action: 'auth.register.success' },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.targetType).toBe('User');
    expect(auditRow?.targetId).toBe(userId);
  });

  it('rejects a duplicate email with 409 CONFLICT and creates no orphaned rows', async () => {
    if (!dbAvailable || !app) return;

    const payload = validPayload();
    await request(app.getHttpServer()).post('/api/v1/auth/register').send(payload).expect(201);

    const duplicateOrgName = `${TEST_PREFIX}Org ${randomUUID()}`;
    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(validPayload({ email: payload.email, organizationName: duplicateOrgName }))
      .expect(409);

    expect(duplicate.body.success).toBe(false);
    expect(duplicate.body.code).toBe('CONFLICT');

    const orphanedOrg = await prisma.organization.findFirst({
      where: { name: duplicateOrgName },
    });
    expect(orphanedOrg).toBeNull();
  });

  it('rejects a duplicate organization slug with 409 CONFLICT and creates no orphaned user', async () => {
    if (!dbAvailable || !app) return;

    const sharedOrgName = `${TEST_PREFIX}Shared Org ${randomUUID()}`;
    const first = validPayload({ organizationName: sharedOrgName });
    await request(app.getHttpServer()).post('/api/v1/auth/register').send(first).expect(201);

    const secondEmail = `${TEST_PREFIX}${randomUUID()}@example.com`;
    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(validPayload({ email: secondEmail, organizationName: sharedOrgName }))
      .expect(409);

    expect(duplicate.body.code).toBe('CONFLICT');

    const orphanedUser = await prisma.user.findUnique({ where: { email: secondEmail } });
    expect(orphanedUser).toBeNull();
  });

  it('rejects a weak password with 400 VALIDATION_ERROR', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(validPayload({ password: 'short' }))
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed email with 400 VALIDATION_ERROR', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(validPayload({ email: 'not-an-email' }))
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects missing required consent with 400 VALIDATION_ERROR', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(validPayload({ consents: { termsOfService: false, privacyPolicy: true } }))
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-boolean consent value with 400 VALIDATION_ERROR (regression: Phase 3.4 live E2E verification)', async () => {
    if (!dbAvailable || !app) return;

    // Before the global ValidationPipe fix, class-transformer's implicit
    // conversion coerced any non-empty string to `true`, so a malformed
    // "yes" would have silently satisfied both @IsBoolean() and the
    // required-consent business rule - a real bypass of consent capture.
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(validPayload({ consents: { termsOfService: 'yes', privacyPolicy: true } }))
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unexpected body fields (whitelist + forbidNonWhitelisted)', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(validPayload({ isAdmin: true }))
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed JSON with 400', async () => {
    if (!dbAvailable || !app) return;

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"email": "broken",')
      .expect(400);
  });

  it('rejects a non-owner intent with 400 VALIDATION_ERROR (customer registration is not implemented yet)', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(validPayload({ intent: 'customer' }))
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a missing organizationName with 400 VALIDATION_ERROR', async () => {
    if (!dbAvailable || !app) return;

    const payload = validPayload();
    delete payload.organizationName;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(payload)
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('normalizes and lowercases the email, matching Email VO behavior', async () => {
    if (!dbAvailable || !app) return;

    const mixedCaseEmail = `${TEST_PREFIX}${randomUUID()}@Example.COM`;
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(validPayload({ email: mixedCaseEmail }))
      .expect(201);

    expect(response.body.data.email).toBe(mixedCaseEmail.toLowerCase());
  });
});
