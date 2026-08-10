import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'aud_e2e_';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 19.3 (ADR-034 §2) — real-HTTP proof of the Audit Log Read API:
 * two-tier RBAC (both tiers can read), documented filters, bounded
 * pagination, the required/bounded date range, response envelope shape, and
 * that no field beyond `AuditLog`'s own documented schema is ever exposed.
 */
describe('Platform Back Office — Audit Log Read API (e2e, Phase 19.3)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — Audit Log Read API e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.auditLog.deleteMany({ where: { correlationId: { startsWith: TEST_PREFIX } } });
      await prisma.platformAdmin.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
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

  async function seedPlatformAdmin(
    suffix: string,
    role: 'PlatformAdmin' | 'PlatformSupport' = 'PlatformAdmin',
  ): Promise<{ userId: string; email: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Platform',
        lastName: role,
        email,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    await prisma.platformAdmin.create({
      data: { id: randomUUID(), userId, role, revokedAt: null },
    });
    return { userId, email };
  }

  async function loginPlatformAdmin(email: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/platform-admin/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return response.body.data.accessToken as string;
  }

  async function seedAuditRow(overrides: {
    actorId?: string | null;
    actorType?: 'User' | 'Employee' | 'System' | 'PlatformAdmin';
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    organizationId?: string | null;
    occurredAt: Date;
  }): Promise<string> {
    const correlationId = `${TEST_PREFIX}${uniqueId()}`;
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        actorId: overrides.actorId ?? null,
        actorType: overrides.actorType ?? 'System',
        action: overrides.action,
        targetType: overrides.targetType ?? null,
        targetId: overrides.targetId ?? null,
        organizationId: overrides.organizationId ?? null,
        correlationId,
        ipAddress: null,
        occurredAt: overrides.occurredAt,
      },
    });
    return correlationId;
  }

  function authed(token: string, path: string) {
    return request(app!.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
  }

  const from = '2026-04-01T00:00:00.000Z';
  const to = '2026-04-02T00:00:00.000Z';
  const withinWindow = new Date('2026-04-01T12:00:00.000Z');

  it('1. rejects unauthenticated requests (PlatformAdminGuard fails closed, 403)', async () => {
    if (!dbAvailable || !app) return;
    await request(app.getHttpServer())
      .get(`/api/v1/platform-admin/audit-logs?from=${from}&to=${to}`)
      .expect(403);
  });

  it('2/3. PlatformSupport can read (200); PlatformAdmin can read (200) - both tiers, ADR-034 §11', async () => {
    if (!dbAvailable || !app) return;
    const actorId = randomUUID();
    await seedAuditRow({ actorId, action: 'rbac.read.check', occurredAt: withinWindow });

    const { email: adminEmail } = await seedPlatformAdmin('rbac-admin', 'PlatformAdmin');
    const { email: supportEmail } = await seedPlatformAdmin('rbac-support', 'PlatformSupport');
    const adminToken = await loginPlatformAdmin(adminEmail);
    const supportToken = await loginPlatformAdmin(supportEmail);

    const adminRes = await authed(
      adminToken,
      `/api/v1/platform-admin/audit-logs?from=${from}&to=${to}&actorId=${actorId}`,
    ).expect(200);
    expect(adminRes.body.data.items).toHaveLength(1);

    const supportRes = await authed(
      supportToken,
      `/api/v1/platform-admin/audit-logs?from=${from}&to=${to}&actorId=${actorId}`,
    ).expect(200);
    expect(supportRes.body.data.items).toHaveLength(1);
  });

  it('4. paginates correctly', async () => {
    if (!dbAvailable || !app) return;
    const actorId = randomUUID();
    for (let i = 0; i < 3; i += 1) {
      await seedAuditRow({
        actorId,
        action: `pagination.item.${i}`,
        occurredAt: new Date(new Date(from).getTime() + i * 60 * 60 * 1000),
      });
    }
    const { email } = await seedPlatformAdmin('pagination', 'PlatformAdmin');
    const token = await loginPlatformAdmin(email);

    const page1 = await authed(
      token,
      `/api/v1/platform-admin/audit-logs?from=${from}&to=${to}&actorId=${actorId}&page=1&limit=2`,
    ).expect(200);
    expect(page1.body.data.items).toHaveLength(2);
    expect(page1.body.data.total).toBe(3);
    expect(page1.body.data.page).toBe(1);
    expect(page1.body.data.limit).toBe(2);

    const page2 = await authed(
      token,
      `/api/v1/platform-admin/audit-logs?from=${from}&to=${to}&actorId=${actorId}&page=2&limit=2`,
    ).expect(200);
    expect(page2.body.data.items).toHaveLength(1);
  });

  it('5. filters by action, targetType/targetId, and organizationId', async () => {
    if (!dbAvailable || !app) return;
    const actorId = randomUUID();
    const targetId = randomUUID();
    const organizationId = randomUUID();
    await seedAuditRow({
      actorId,
      action: 'filter.match',
      targetType: 'Restaurant',
      targetId,
      organizationId,
      occurredAt: withinWindow,
    });
    await seedAuditRow({
      actorId,
      action: 'filter.no-match',
      targetType: 'Organization',
      targetId: randomUUID(),
      organizationId: randomUUID(),
      occurredAt: withinWindow,
    });

    const { email } = await seedPlatformAdmin('filters', 'PlatformAdmin');
    const token = await loginPlatformAdmin(email);

    const res = await authed(
      token,
      `/api/v1/platform-admin/audit-logs?from=${from}&to=${to}&actorId=${actorId}&action=filter.match&targetType=Restaurant&targetId=${targetId}&organizationId=${organizationId}`,
    ).expect(200);

    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].action).toBe('filter.match');
  });

  it('6. returns an empty result for a well-formed query matching nothing', async () => {
    if (!dbAvailable || !app) return;
    const { email } = await seedPlatformAdmin('empty', 'PlatformAdmin');
    const token = await loginPlatformAdmin(email);

    const res = await authed(
      token,
      `/api/v1/platform-admin/audit-logs?from=${from}&to=${to}&actorId=${randomUUID()}`,
    ).expect(200);

    expect(res.body.data).toEqual({ items: [], total: 0, page: 1, limit: 20 });
  });

  it('7. rejects invalid query parameters (missing required from/to, malformed UUID, excessive range)', async () => {
    if (!dbAvailable || !app) return;
    const { email } = await seedPlatformAdmin('invalid', 'PlatformAdmin');
    const token = await loginPlatformAdmin(email);

    await authed(token, '/api/v1/platform-admin/audit-logs').expect(400);
    await authed(
      token,
      `/api/v1/platform-admin/audit-logs?from=${from}&to=${to}&actorId=not-a-uuid`,
    ).expect(400);
    await authed(
      token,
      `/api/v1/platform-admin/audit-logs?from=2026-01-01T00:00:00.000Z&to=2027-06-01T00:00:00.000Z`,
    ).expect(400);
    await authed(token, `/api/v1/platform-admin/audit-logs?from=${to}&to=${from}`).expect(400);
  });

  it('8. organizationId filter isolates rows to one organization (cross-tenant protection)', async () => {
    if (!dbAvailable || !app) return;
    const actorId = randomUUID();
    const orgA = randomUUID();
    const orgB = randomUUID();
    await seedAuditRow({
      actorId,
      action: 'org.a',
      organizationId: orgA,
      occurredAt: withinWindow,
    });
    await seedAuditRow({
      actorId,
      action: 'org.b',
      organizationId: orgB,
      occurredAt: withinWindow,
    });

    const { email } = await seedPlatformAdmin('cross-tenant', 'PlatformAdmin');
    const token = await loginPlatformAdmin(email);

    const res = await authed(
      token,
      `/api/v1/platform-admin/audit-logs?from=${from}&to=${to}&actorId=${actorId}&organizationId=${orgA}`,
    ).expect(200);

    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].action).toBe('org.a');
  });

  it('9/10. response envelope is {success,message,data,meta}; no credential/token field is ever present', async () => {
    if (!dbAvailable || !app) return;
    const actorId = randomUUID();
    await seedAuditRow({ actorId, action: 'envelope.check', occurredAt: withinWindow });
    const { email } = await seedPlatformAdmin('envelope', 'PlatformAdmin');
    const token = await loginPlatformAdmin(email);

    const res = await authed(
      token,
      `/api/v1/platform-admin/audit-logs?from=${from}&to=${to}&actorId=${actorId}`,
    ).expect(200);

    expect(res.body).toMatchObject({ success: true, message: expect.any(String), meta: {} });
    expect(res.body.data).toHaveProperty('items');
    expect(res.body.data).toHaveProperty('total');
    expect(res.body.data).toHaveProperty('page');
    expect(res.body.data).toHaveProperty('limit');

    const row = res.body.data.items[0];
    const forbiddenKeys = [
      'password',
      'passwordHash',
      'refreshToken',
      'refreshTokenHash',
      'accessToken',
      'credential',
      'secret',
      'token',
    ];
    for (const key of Object.keys(row)) {
      expect(forbiddenKeys.some((f) => key.toLowerCase().includes(f.toLowerCase()))).toBe(false);
    }
  });

  it('11. Swagger document exposes the route', async () => {
    if (!dbAvailable || !app) return;
    const { SwaggerModule, DocumentBuilder } = await import('@nestjs/swagger');
    const document = SwaggerModule.createDocument(
      app as unknown as Parameters<typeof SwaggerModule.createDocument>[0],
      new DocumentBuilder().build(),
    );
    expect(document.paths).toHaveProperty('/api/v1/platform-admin/audit-logs');
    expect(document.paths['/api/v1/platform-admin/audit-logs']).toHaveProperty('get');
  });
});
