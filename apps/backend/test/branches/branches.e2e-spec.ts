import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'branch-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

describe('/api/v1/restaurants/:restaurantId/branches (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — branches e2e tests NOT EXECUTED.');
      return;
    }
    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.branch.deleteMany({
        where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
      });
      await prisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
      await prisma.organizationMember.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.deviceSession.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organization.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function registerAndLoginOwner(
    suffix: string,
  ): Promise<{ accessToken: string; organizationId: string; userId: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const registerResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        intent: 'owner',
        email,
        password: PASSWORD,
        firstName: 'Owner',
        lastName: suffix,
        organizationName: `${TEST_PREFIX}Org ${suffix} ${uniqueId()}`,
        consents: { termsOfService: true, privacyPolicy: true },
      })
      .expect(201);
    const userId = registerResponse.body.data.userId as string;

    await prisma.user.update({
      where: { id: userId },
      data: { status: 'Active', emailVerified: true },
    });

    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);

    return {
      accessToken: loginResponse.body.data.accessToken as string,
      organizationId: loginResponse.body.data.organization.organizationId as string,
      userId,
    };
  }

  async function createRestaurant(accessToken: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'The Old Mill', slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    return response.body.data.restaurantId as string;
  }

  const validCreateBody = {
    city: 'Damascus',
    district: 'Malki',
    address: '123 Main St',
    countryCode: 'SY',
    currency: 'SYP',
    timezone: 'Asia/Damascus',
    phone: '+963900000000',
  };

  it('POST creates a branch scoped to the given restaurant and writes an audit log entry', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('create');
    const restaurantId = await createRestaurant(owner.accessToken);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(validCreateBody)
      .expect(201);

    expect(response.body.data).toMatchObject({ restaurantId, ...validCreateBody });
    expect(response.body.data.branchId).toBeTruthy();

    const persisted = await prisma.branch.findUnique({
      where: { id: response.body.data.branchId },
    });
    expect(persisted?.restaurantId).toBe(restaurantId);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { targetId: response.body.data.branchId, action: 'branch.created' },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.actorId).toBe(owner.userId);
  });

  it('POST rejects a request with no Authorization header', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('noauth');
    const restaurantId = await createRestaurant(owner.accessToken);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .send(validCreateBody)
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('POST rejects missing required field (city) with 400', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('validation');
    const restaurantId = await createRestaurant(owner.accessToken);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, city: undefined })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST rejects an invalid countryCode format with 400', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('bad-country');
    const restaurantId = await createRestaurant(owner.accessToken);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, countryCode: 'Syria' })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST returns 404 when the restaurant does not exist', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('no-restaurant');

    const response = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${randomUUID()}/branches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(validCreateBody)
      .expect(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('GET/PATCH/DELETE full lifecycle: persists, retrieves, updates, and soft-deletes', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('lifecycle');
    const restaurantId = await createRestaurant(owner.accessToken);

    const createResponse = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(validCreateBody)
      .expect(201);
    const branchId = createResponse.body.data.branchId as string;

    const getResponse = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/branches/${branchId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(getResponse.body.data.city).toBe('Damascus');

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/branches/${branchId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, city: 'Aleppo', currency: 'USD' })
      .expect(200);
    expect(patchResponse.body.data.city).toBe('Aleppo');
    expect(patchResponse.body.data.currency).toBe('USD');

    const updateAudit = await prisma.auditLog.findFirst({
      where: { targetId: branchId, action: 'branch.updated' },
    });
    expect(updateAudit).not.toBeNull();

    await request(app.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}/branches/${branchId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/branches/${branchId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);

    const deleteAudit = await prisma.auditLog.findFirst({
      where: { targetId: branchId, action: 'branch.deleted' },
    });
    expect(deleteAudit).not.toBeNull();

    // deleting again (already removed) is not idempotent - 404
    await request(app.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}/branches/${branchId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);
  });

  it('LIST supports pagination and only returns the given restaurant own branches', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('list');
    const restaurantA = await createRestaurant(owner.accessToken);
    const restaurantB = await createRestaurant(owner.accessToken);

    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantA}/branches`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ ...validCreateBody, city: `City ${i}` })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantB}/branches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(validCreateBody)
      .expect(201);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantA}/branches`)
      .query({ page: 1, limit: 2 })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.data.items).toHaveLength(2);
    expect(response.body.data.total).toBe(3);
    expect(
      response.body.data.items.every(
        (item: { restaurantId: string }) => item.restaurantId === restaurantA,
      ),
    ).toBe(true);
  });

  it("two different organizations never see each other's branches - GET/LIST/PATCH/DELETE all return 404 across tenants", async () => {
    if (!dbAvailable || !app) return;

    const ownerA = await registerAndLoginOwner('isolation-a');
    const ownerB = await registerAndLoginOwner('isolation-b');
    const restaurantId = await createRestaurant(ownerA.accessToken);

    const createResponse = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send(validCreateBody)
      .expect(201);
    const branchId = createResponse.body.data.branchId as string;

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/branches/${branchId}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/branches/${branchId}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send(validCreateBody)
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}/branches/${branchId}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);

    const stillActive = await prisma.branch.findUnique({ where: { id: branchId } });
    expect(stillActive?.deletedAt).toBeNull();
  });

  it('POST/GET/PATCH/DELETE across restaurants (same org) both return 404 - IDOR protection', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('idor');
    const restaurantA = await createRestaurant(owner.accessToken);
    const restaurantB = await createRestaurant(owner.accessToken);

    const createResponse = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantA}/branches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(validCreateBody)
      .expect(201);
    const branchId = createResponse.body.data.branchId as string;

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantB}/branches/${branchId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantB}/branches/${branchId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(validCreateBody)
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantB}/branches/${branchId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);

    const stillActive = await prisma.branch.findUnique({ where: { id: branchId } });
    expect(stillActive?.deletedAt).toBeNull();
  });

  it('GET rejects a non-UUID branchId with 400', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('bad-uuid');
    const restaurantId = await createRestaurant(owner.accessToken);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/branches/not-a-uuid`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('accepts null district, currency, and phone', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('nullable-fields');
    const restaurantId = await createRestaurant(owner.accessToken);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        city: 'Damascus',
        address: '123 Main St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      })
      .expect(201);

    expect(response.body.data.district).toBeNull();
    expect(response.body.data.currency).toBeNull();
    expect(response.body.data.phone).toBeNull();
  });

  it('POST/PATCH accept and persist valid latitude/longitude (ADR-018)', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('geo-valid');
    const restaurantId = await createRestaurant(owner.accessToken);

    const createResponse = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, latitude: 33.5138, longitude: 36.2765 })
      .expect(201);
    expect(createResponse.body.data.latitude).toBe(33.5138);
    expect(createResponse.body.data.longitude).toBe(36.2765);
    const branchId = createResponse.body.data.branchId as string;

    const persisted = await prisma.branch.findUnique({ where: { id: branchId } });
    expect(persisted?.latitude?.toNumber()).toBe(33.5138);
    expect(persisted?.longitude?.toNumber()).toBe(36.2765);

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/branches/${branchId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, latitude: 35.1137, longitude: 36.7642 })
      .expect(200);
    expect(patchResponse.body.data.latitude).toBe(35.1137);
    expect(patchResponse.body.data.longitude).toBe(36.7642);
  });

  it('POST rejects latitude without longitude with 400', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('geo-partial');
    const restaurantId = await createRestaurant(owner.accessToken);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, latitude: 33.5138 })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST rejects an out-of-range latitude with 400', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('geo-out-of-range');
    const restaurantId = await createRestaurant(owner.accessToken);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, latitude: 91, longitude: 36.2765 })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  const validWorkingHoursPatch = {
    entries: [
      { dayOfWeek: 1, openingTime: '09:00', closingTime: '22:00' },
      {
        dayOfWeek: 2,
        openingTime: '09:00',
        closingTime: '22:00',
        breakStartTime: '15:00',
        breakEndTime: '16:00',
      },
    ],
  };

  async function createBranch(accessToken: string, restaurantId: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validCreateBody)
      .expect(201);
    return response.body.data.branchId as string;
  }

  it('GET .../working-hours returns an empty entries array right after branch creation', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('wh-defaults');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.data).toEqual({ branchId, entries: [] });
  });

  it('PATCH .../working-hours full-replaces the week and writes an audit log entry', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('wh-update');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(validWorkingHoursPatch)
      .expect(200);

    expect(patchResponse.body.data.branchId).toBe(branchId);
    expect(patchResponse.body.data.entries).toHaveLength(2);
    expect(patchResponse.body.data.entries[1]).toMatchObject({
      dayOfWeek: 2,
      breakStartTime: '15:00',
      breakEndTime: '16:00',
    });

    const getResponse = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(getResponse.body.data.entries).toHaveLength(2);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { targetId: branchId, action: 'branch.working_hours.updated' },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.actorId).toBe(owner.userId);
  });

  it('PATCH .../working-hours a day omitted from a later PATCH is removed', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('wh-partial');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);

    await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(validWorkingHoursPatch)
      .expect(200);

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ entries: [validWorkingHoursPatch.entries[0]] })
      .expect(200);

    expect(patchResponse.body.data.entries).toHaveLength(1);
    expect(patchResponse.body.data.entries[0].dayOfWeek).toBe(1);
  });

  it('PATCH .../working-hours rejects a duplicate dayOfWeek with 400', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('wh-validation');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        entries: [
          { dayOfWeek: 1, openingTime: '09:00', closingTime: '22:00' },
          { dayOfWeek: 1, openingTime: '10:00', closingTime: '20:00' },
        ],
      })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH .../working-hours rejects a malformed time with 400', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('wh-bad-time');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ entries: [{ dayOfWeek: 1, openingTime: '9am', closingTime: '22:00' }] })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it("two different organizations never see each other's branch working hours - GET/PATCH both return 404 across tenants", async () => {
    if (!dbAvailable || !app) return;

    const ownerA = await registerAndLoginOwner('wh-isolation-a');
    const ownerB = await registerAndLoginOwner('wh-isolation-b');
    const restaurantId = await createRestaurant(ownerA.accessToken);
    const branchId = await createBranch(ownerA.accessToken, restaurantId);

    await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/working-hours`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send(validWorkingHoursPatch)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/working-hours`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/branches/${branchId}/working-hours`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ entries: [] })
      .expect(404);

    const stillTwoRows = await prisma.branchWorkingHours.count({ where: { branchId } });
    expect(stillTwoRows).toBe(2);
  });

  it('.../working-hours across restaurants (same org) both return 404 - IDOR protection', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('wh-idor');
    const restaurantA = await createRestaurant(owner.accessToken);
    const restaurantB = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantA);

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantB}/branches/${branchId}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantB}/branches/${branchId}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(validWorkingHoursPatch)
      .expect(404);
  });
});
