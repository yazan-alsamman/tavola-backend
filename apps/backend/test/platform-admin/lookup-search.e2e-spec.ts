import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'lkp_e2e_';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 19.7 — narrow per-entity lookup/search (ADR-034 §13). Real-HTTP
 * proof of the four lookup routes: `GET /platform-admin/restaurants`,
 * `GET /platform-admin/organizations`, `GET /platform-admin/acquisitions/:id`,
 * `GET /platform-admin/pricing/rules` (extended with label/id filters).
 * Mirrors `dashboard.e2e-spec.ts`'s structure exactly.
 */
describe('Platform Back Office — narrow lookup/search (e2e, Phase 19.7)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';
  let platformPricingRuleId: string | undefined;

  const createdOrganizationIds: string[] = [];
  const createdRestaurantIds: string[] = [];
  const createdAcquisitionIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdPricingRuleIds: string[] = [];

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — lookup/search e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();
    const platformRule = await prisma.acquisitionPricingRule.findFirst({
      where: { scopeType: 'Platform', archivedAt: null },
    });
    platformPricingRuleId = platformRule?.id;
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.customerAcquisition.deleteMany({
        where: { id: { in: createdAcquisitionIds } },
      });
      await prisma.acquisitionPricingRule.deleteMany({
        where: { id: { in: createdPricingRuleIds } },
      });
      await prisma.restaurant.deleteMany({ where: { id: { in: createdRestaurantIds } } });
      await prisma.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
      await prisma.platformAdmin.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.deviceSession.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.user.deleteMany({
        where: { OR: [{ email: { startsWith: TEST_PREFIX } }, { id: { in: createdUserIds } }] },
      });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function seedPlatformAdmin(
    suffix: string,
    role: 'PlatformAdmin' | 'PlatformSupport' = 'PlatformAdmin',
  ): Promise<{ email: string }> {
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
    return { email };
  }

  async function loginPlatformAdmin(email: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/platform-admin/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return response.body.data.accessToken as string;
  }

  function authed(token: string, path: string) {
    return request(app!.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
  }

  async function seedOrganizationAndRestaurant(
    name: string,
  ): Promise<{ organizationId: string; restaurantId: string }> {
    const organizationId = randomUUID();
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: `${TEST_PREFIX}org_${organizationId}`,
        slug: `${TEST_PREFIX}org-${organizationId}`,
        billingEmail: `${TEST_PREFIX}${organizationId}@example.test`,
      },
    });
    createdOrganizationIds.push(organizationId);

    const restaurantId = randomUUID();
    await prisma.restaurant.create({
      data: {
        id: restaurantId,
        organizationId,
        name,
        slug: `${TEST_PREFIX}rst-${restaurantId}`,
        status: 'Active',
      },
    });
    createdRestaurantIds.push(restaurantId);
    return { organizationId, restaurantId };
  }

  describe('GET /platform-admin/restaurants', () => {
    it('rejects unauthenticated requests (403) and allows both PlatformAdmin tiers (200)', async () => {
      if (!dbAvailable || !app) return;
      await request(app.getHttpServer()).get('/api/v1/platform-admin/restaurants').expect(403);

      const { email: adminEmail } = await seedPlatformAdmin('rst-admin', 'PlatformAdmin');
      const { email: supportEmail } = await seedPlatformAdmin('rst-support', 'PlatformSupport');
      const adminToken = await loginPlatformAdmin(adminEmail);
      const supportToken = await loginPlatformAdmin(supportEmail);

      await authed(adminToken, '/api/v1/platform-admin/restaurants').expect(200);
      await authed(supportToken, '/api/v1/platform-admin/restaurants').expect(200);
    });

    it('finds a seeded restaurant by partial, case-insensitive name; empty q lists it too', async () => {
      if (!dbAvailable || !app) return;
      const { email } = await seedPlatformAdmin('rst-search', 'PlatformAdmin');
      const token = await loginPlatformAdmin(email);
      const uniqueToken = uniqueId();
      const name = `${TEST_PREFIX}Sunset Diner ${uniqueToken}`;
      await seedOrganizationAndRestaurant(name);

      const res = await authed(
        token,
        `/api/v1/platform-admin/restaurants?q=${encodeURIComponent(`sunset diner ${uniqueToken}`.toUpperCase())}`,
      ).expect(200);
      expect(res.body.data.items.map((r: { name: string }) => r.name)).toContain(name);

      const listAll = await authed(token, '/api/v1/platform-admin/restaurants?limit=100').expect(
        200,
      );
      expect(listAll.body.data.items.map((r: { name: string }) => r.name)).toContain(name);

      const noResult = await authed(
        token,
        `/api/v1/platform-admin/restaurants?q=${uniqueToken}-does-not-exist`,
      ).expect(200);
      expect(noResult.body.data.items).toEqual([]);
    });
  });

  describe('GET /platform-admin/organizations', () => {
    it('rejects unauthenticated requests (403) and finds a seeded organization by partial name', async () => {
      if (!dbAvailable || !app) return;
      await request(app.getHttpServer()).get('/api/v1/platform-admin/organizations').expect(403);

      const { email } = await seedPlatformAdmin('org-search', 'PlatformAdmin');
      const token = await loginPlatformAdmin(email);
      const uniqueToken = uniqueId();
      const name = `${TEST_PREFIX}Harborview Holdings ${uniqueToken}`;
      const organizationId = randomUUID();
      await prisma.organization.create({
        data: {
          id: organizationId,
          name,
          slug: `${TEST_PREFIX}org-${organizationId}`,
          billingEmail: `${TEST_PREFIX}${organizationId}@example.test`,
        },
      });
      createdOrganizationIds.push(organizationId);

      const res = await authed(token, `/api/v1/platform-admin/organizations?q=Harborview`).expect(
        200,
      );
      expect(res.body.data.items.map((o: { name: string }) => o.name)).toContain(name);
    });
  });

  describe('GET /platform-admin/acquisitions/:id', () => {
    it('rejects unauthenticated requests (403); returns 404 for unknown id; returns the record for a known id', async () => {
      if (!dbAvailable || !app) return;
      await request(app.getHttpServer())
        .get(`/api/v1/platform-admin/acquisitions/${randomUUID()}`)
        .expect(403);

      const { email } = await seedPlatformAdmin('acq-search', 'PlatformAdmin');
      const token = await loginPlatformAdmin(email);

      await authed(token, `/api/v1/platform-admin/acquisitions/${randomUUID()}`).expect(404);

      if (!platformPricingRuleId) {
        console.warn(
          'No Platform-scope AcquisitionPricingRule seeded - skipping found-record assertion.',
        );
        return;
      }
      const { restaurantId } = await seedOrganizationAndRestaurant(
        `${TEST_PREFIX}rst_${uniqueId()}`,
      );
      const userId = randomUUID();
      await prisma.user.create({
        data: {
          id: userId,
          firstName: 'Acq',
          lastName: 'Customer',
          email: `${TEST_PREFIX}customer-${uniqueId()}@example.com`,
          passwordHash,
          language: 'en',
          status: 'Active',
          emailVerified: true,
        },
      });
      createdUserIds.push(userId);
      const acquisitionId = randomUUID();
      await prisma.customerAcquisition.create({
        data: {
          id: acquisitionId,
          restaurantId,
          userId,
          createdVia: 'ManualPlatformAdminCorrection',
          status: 'Recorded',
          feeAmount: 1000,
          feeCurrency: 'SYP',
          pricingRuleId: platformPricingRuleId,
        },
      });
      createdAcquisitionIds.push(acquisitionId);

      const res = await authed(
        token,
        `/api/v1/platform-admin/acquisitions/${acquisitionId}`,
      ).expect(200);
      expect(res.body.data.id).toBe(acquisitionId);
      expect(res.body.data.restaurantId).toBe(restaurantId);
    });
  });

  describe('GET /platform-admin/pricing/rules', () => {
    it('rejects unauthenticated requests (403); label/id filters both work', async () => {
      if (!dbAvailable || !app) return;
      await request(app.getHttpServer()).get('/api/v1/platform-admin/pricing/rules').expect(403);

      const { email } = await seedPlatformAdmin('pricing-search', 'PlatformAdmin');
      const token = await loginPlatformAdmin(email);
      const uniqueToken = uniqueId();
      const label = `${TEST_PREFIX}Autumn Campaign ${uniqueToken}`;
      const ruleId = randomUUID();
      await prisma.acquisitionPricingRule.create({
        data: {
          id: ruleId,
          scopeType: 'Platform',
          feeType: 'Flat',
          flatAmount: 500,
          flatCurrency: 'SYP',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          label,
          createdBy: randomUUID(),
        },
      });
      createdPricingRuleIds.push(ruleId);

      const byLabel = await authed(
        token,
        `/api/v1/platform-admin/pricing/rules?label=${encodeURIComponent(`autumn campaign ${uniqueToken}`.toUpperCase())}`,
      ).expect(200);
      expect(byLabel.body.data.items.map((r: { label: string }) => r.label)).toContain(label);

      const byId = await authed(token, `/api/v1/platform-admin/pricing/rules?id=${ruleId}`).expect(
        200,
      );
      expect(byId.body.data.items).toHaveLength(1);
      expect(byId.body.data.items[0].id).toBe(ruleId);

      const noResult = await authed(
        token,
        `/api/v1/platform-admin/pricing/rules?label=${uniqueToken}-does-not-exist`,
      ).expect(200);
      expect(noResult.body.data.items).toEqual([]);
    });
  });

  it('Swagger document exposes all four lookup routes', async () => {
    if (!dbAvailable || !app) return;
    const { SwaggerModule, DocumentBuilder } = await import('@nestjs/swagger');
    const document = SwaggerModule.createDocument(
      app as unknown as Parameters<typeof SwaggerModule.createDocument>[0],
      new DocumentBuilder().build(),
    );
    expect(document.paths['/api/v1/platform-admin/restaurants']).toHaveProperty('get');
    expect(document.paths['/api/v1/platform-admin/organizations']).toHaveProperty('get');
    expect(document.paths['/api/v1/platform-admin/acquisitions/{id}']).toHaveProperty('get');
    expect(document.paths['/api/v1/platform-admin/pricing/rules']).toHaveProperty('get');
  });
});
