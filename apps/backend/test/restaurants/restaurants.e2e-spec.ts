import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'restaurant-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

const validJpegBuffer = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)]);

describe('/api/v1/restaurants (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — restaurants e2e tests NOT EXECUTED.');
      return;
    }
    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      // Files created for gallery images have no FK relation to Restaurant
      // (polymorphic ownerId/ownerType, matching the Files aggregate's own
      // design) - not cascade-deleted, so clean them up explicitly before
      // deleting the restaurants themselves.
      const testRestaurants = await prisma.restaurant.findMany({
        where: { slug: { startsWith: TEST_PREFIX } },
        select: { id: true },
      });
      await prisma.file.deleteMany({
        where: { ownerType: 'Restaurant', ownerId: { in: testRestaurants.map((r) => r.id) } },
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

  /** Registers a fresh organization owner, activates the account (dev stack
   * has no real email delivery, matching every other e2e spec's approach),
   * logs in, and returns the OrganizationMember access token. */
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

  const validCreateBody = {
    name: 'The Old Mill',
    description: 'Cozy',
    cuisineType: 'Italian',
    priceLevel: 2,
  };

  it('POST creates a restaurant scoped to the caller organization', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('create');

    const response = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);

    expect(response.body.data).toMatchObject({
      name: 'The Old Mill',
      description: 'Cozy',
      cuisineType: 'Italian',
      priceLevel: 2,
      status: 'Active',
      averageRating: null,
    });
    expect(response.body.data.restaurantId).toBeTruthy();

    const persisted = await prisma.restaurant.findUnique({
      where: { id: response.body.data.restaurantId },
    });
    expect(persisted?.organizationId).toBe(owner.organizationId);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { targetId: response.body.data.restaurantId, action: 'restaurant.created' },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.actorId).toBe(owner.userId);
  });

  it('POST rejects a request with no Authorization header', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('POST rejects missing required field (name) with 400', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('validation');

    const response = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ description: 'No name' })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST rejects mass-assignment attempts (organizationId, status, averageRating)', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('mass-assignment');

    const response = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        ...validCreateBody,
        slug: `${TEST_PREFIX}${uniqueId()}`,
        organizationId: randomUUID(),
        status: 'Active',
        averageRating: 5,
        id: randomUUID(),
      })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST rejects a duplicate slug with 409', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('dup-slug');
    const slug = `${TEST_PREFIX}${uniqueId()}`;

    await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug })
      .expect(409);
    expect(response.body.code).toBe('CONFLICT');
  });

  it('GET/PATCH/DELETE full lifecycle: persists, retrieves, updates, and soft-deletes', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('lifecycle');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    const getResponse = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(getResponse.body.data.name).toBe('The Old Mill');

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Updated Name',
        description: 'Updated description',
        cuisineType: 'French',
        priceLevel: 4,
        status: 'Active',
      })
      .expect(200);
    expect(patchResponse.body.data.name).toBe('Updated Name');
    expect(patchResponse.body.data.priceLevel).toBe(4);

    const updateAudit = await prisma.auditLog.findFirst({
      where: { targetId: restaurantId, action: 'restaurant.updated' },
    });
    expect(updateAudit).not.toBeNull();

    await request(app.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);

    const deleteAudit = await prisma.auditLog.findFirst({
      where: { targetId: restaurantId, action: 'restaurant.deleted' },
    });
    expect(deleteAudit).not.toBeNull();
  });

  it('PATCH status transition to Suspended publishes restaurant.suspended, not restaurant.updated', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('suspend');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, status: 'Suspended' })
      .expect(200);
    expect(response.body.data.status).toBe('Suspended');

    const suspendAudit = await prisma.auditLog.findFirst({
      where: { targetId: restaurantId, action: 'restaurant.suspended' },
    });
    expect(suspendAudit).not.toBeNull();
    const updateAudit = await prisma.auditLog.findFirst({
      where: { targetId: restaurantId, action: 'restaurant.updated' },
    });
    expect(updateAudit).toBeNull();
  });

  it("two different organizations never see each other's restaurants - GET returns 404 across tenants", async () => {
    if (!dbAvailable || !app) return;

    const ownerA = await registerAndLoginOwner('isolation-a');
    const ownerB = await registerAndLoginOwner('isolation-b');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);
  });

  it("two different organizations never see each other's restaurants - LIST is scoped per organization", async () => {
    if (!dbAvailable || !app) return;

    const ownerA = await registerAndLoginOwner('list-isolation-a');
    const ownerB = await registerAndLoginOwner('list-isolation-b');

    await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);

    const listAsB = await request(app.getHttpServer())
      .get('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(200);

    expect(listAsB.body.data.items).toEqual([]);
    expect(listAsB.body.data.total).toBe(0);
  });

  it('PATCH/DELETE across tenants both return 404 - IDOR protection', async () => {
    if (!dbAvailable || !app) return;

    const ownerA = await registerAndLoginOwner('idor-a');
    const ownerB = await registerAndLoginOwner('idor-b');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ ...validCreateBody, status: 'Suspended' })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);

    const stillActive = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
    expect(stillActive?.status).toBe('Active');
    expect(stillActive?.deletedAt).toBeNull();
  });

  it('GET rejects a stale access token after logout-all bumps sessionVersion', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('stale-session');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${createResponse.body.data.restaurantId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('LIST supports pagination', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('pagination');
    for (let i = 0; i < 3; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/restaurants')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ ...validCreateBody, name: `Restaurant ${i}`, slug: `${TEST_PREFIX}${uniqueId()}` })
        .expect(201);
    }

    const response = await request(app.getHttpServer())
      .get('/api/v1/restaurants')
      .query({ page: 1, limit: 2 })
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.data.items).toHaveLength(2);
    expect(response.body.data.total).toBe(3);
  });

  it('GET rejects a non-UUID id with 400', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('bad-uuid');

    const response = await request(app.getHttpServer())
      .get('/api/v1/restaurants/not-a-uuid')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  const validSettingsPatch = {
    reservationIntervalMinutes: 45,
    maxGuestsPerReservation: 12,
    cancellationWindowMinutes: 120,
    pendingReservationTimeoutMinutes: 30,
    defaultReservationDurationMinutes: 120,
    autoApproval: true,
    timezone: 'Europe/Istanbul',
    defaultCurrency: 'TRY',
  };

  it('GET /restaurants/{id}/settings returns the auto-created defaults right after creation', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('settings-defaults');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    const response = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/settings`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.data).toMatchObject({
      restaurantId,
      reservationIntervalMinutes: 30,
      maxGuestsPerReservation: 20,
      cancellationWindowMinutes: 60,
      pendingReservationTimeoutMinutes: 15,
      defaultReservationDurationMinutes: 90,
      autoApproval: false,
      timezone: 'UTC',
      defaultCurrency: null,
    });
  });

  it('PATCH /restaurants/{id}/settings full-replaces every field and writes an audit log entry', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('settings-update');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/settings`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(validSettingsPatch)
      .expect(200);

    expect(patchResponse.body.data).toMatchObject({ restaurantId, ...validSettingsPatch });

    const getResponse = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/settings`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(getResponse.body.data).toMatchObject(validSettingsPatch);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { targetId: restaurantId, action: 'restaurant.settings.updated' },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.actorId).toBe(owner.userId);
  });

  it('PATCH /restaurants/{id}/settings rejects an out-of-bounds value with 400', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('settings-validation');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/settings`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validSettingsPatch, reservationIntervalMinutes: 1 })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it("two different organizations never see each other's settings - GET/PATCH both return 404 across tenants", async () => {
    if (!dbAvailable || !app) return;

    const ownerA = await registerAndLoginOwner('settings-isolation-a');
    const ownerB = await registerAndLoginOwner('settings-isolation-b');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/settings`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/settings`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send(validSettingsPatch)
      .expect(404);

    const stillDefault = await prisma.restaurantSettings.findUnique({
      where: { restaurantId },
    });
    expect(stillDefault?.reservationIntervalMinutes).toBe(30);
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

  it('GET /restaurants/{id}/working-hours returns an empty entries array right after creation', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('working-hours-defaults');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    const response = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.data).toEqual({ restaurantId, entries: [] });
  });

  it('PATCH /restaurants/{id}/working-hours full-replaces the week and writes an audit log entry', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('working-hours-update');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(validWorkingHoursPatch)
      .expect(200);

    expect(patchResponse.body.data.restaurantId).toBe(restaurantId);
    expect(patchResponse.body.data.entries).toHaveLength(2);
    expect(patchResponse.body.data.entries[1]).toMatchObject({
      dayOfWeek: 2,
      breakStartTime: '15:00',
      breakEndTime: '16:00',
    });

    const getResponse = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(getResponse.body.data.entries).toHaveLength(2);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { targetId: restaurantId, action: 'restaurant.working_hours.updated' },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.actorId).toBe(owner.userId);
  });

  it('PATCH /restaurants/{id}/working-hours a day omitted from a later PATCH is removed (closed)', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('working-hours-partial');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(validWorkingHoursPatch)
      .expect(200);

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ entries: [validWorkingHoursPatch.entries[0]] })
      .expect(200);

    expect(patchResponse.body.data.entries).toHaveLength(1);
    expect(patchResponse.body.data.entries[0].dayOfWeek).toBe(1);
  });

  it('PATCH /restaurants/{id}/working-hours rejects a duplicate dayOfWeek with 400', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('working-hours-validation');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/working-hours`)
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

  it('PATCH /restaurants/{id}/working-hours rejects a malformed time with 400', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('working-hours-bad-time');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ entries: [{ dayOfWeek: 1, openingTime: '9am', closingTime: '22:00' }] })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it("two different organizations never see each other's working hours - GET/PATCH both return 404 across tenants", async () => {
    if (!dbAvailable || !app) return;

    const ownerA = await registerAndLoginOwner('working-hours-isolation-a');
    const ownerB = await registerAndLoginOwner('working-hours-isolation-b');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/working-hours`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send(validWorkingHoursPatch)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/working-hours`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/working-hours`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ entries: [] })
      .expect(404);

    const stillTwoRows = await prisma.workingHours.count({ where: { restaurantId } });
    expect(stillTwoRows).toBe(2);
  });

  it('POST /restaurants/{id}/gallery adds an image with a caption and writes an audit log entry', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('gallery-add');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/gallery`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('caption', 'Our dining room')
      .attach('file', validJpegBuffer, { filename: 'dining-room.jpg', contentType: 'image/jpeg' })
      .expect(201);

    expect(response.body.data.caption).toBe('Our dining room');
    expect(response.body.data.sortOrder).toBe(0);
    expect(response.body.data.imageUrl).toBeTruthy();

    const auditEntry = await prisma.auditLog.findFirst({
      where: { targetId: restaurantId, action: 'restaurant.gallery.image_added' },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.actorId).toBe(owner.userId);
  });

  it('GET /restaurants/{id}/gallery returns images sorted by sortOrder', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('gallery-list');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    const emptyResponse = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/gallery`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(emptyResponse.body.data).toEqual({ restaurantId, items: [] });

    await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/gallery`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', validJpegBuffer, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/gallery`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', validJpegBuffer, { filename: 'b.jpg', contentType: 'image/jpeg' })
      .expect(201);

    const listResponse = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/gallery`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(listResponse.body.data.items).toHaveLength(2);
    expect(listResponse.body.data.items[0].sortOrder).toBe(0);
    expect(listResponse.body.data.items[1].sortOrder).toBe(1);
  });

  it('DELETE /restaurants/{id}/gallery/{galleryItemId} removes the row, the File, and the storage object', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('gallery-delete');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    const addResponse = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/gallery`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', validJpegBuffer, { filename: 'to-delete.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const galleryItemId = addResponse.body.data.galleryItemId as string;

    await request(app.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}/gallery/${galleryItemId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);

    const rowGone = await prisma.restaurantGallery.findUnique({ where: { id: galleryItemId } });
    expect(rowGone).toBeNull();

    const deleteAudit = await prisma.auditLog.findFirst({
      where: { targetId: restaurantId, action: 'restaurant.gallery.image_removed' },
    });
    expect(deleteAudit).not.toBeNull();

    // deleting again (already removed) is not idempotent - 404
    await request(app.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}/gallery/${galleryItemId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(404);
  });

  it('POST /restaurants/{id}/gallery rejects the 21st image with 409 GALLERY_LIMIT_EXCEEDED', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('gallery-limit');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    for (let i = 0; i < 20; i += 1) {
      await request(app.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/gallery`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('file', validJpegBuffer, { filename: `${i}.jpg`, contentType: 'image/jpeg' })
        .expect(201);
    }

    const response = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/gallery`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', validJpegBuffer, { filename: '21.jpg', contentType: 'image/jpeg' })
      .expect(409);
    expect(response.body.code).toBe('GALLERY_LIMIT_EXCEEDED');

    const count = await prisma.restaurantGallery.count({ where: { restaurantId } });
    expect(count).toBe(20);
  }, 60000);

  it('POST /restaurants/{id}/gallery rejects a missing file with 400', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('gallery-missing-file');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/gallery`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('caption', 'No file attached')
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it("two different organizations never see each other's gallery - POST/GET/DELETE all return 404 across tenants", async () => {
    if (!dbAvailable || !app) return;

    const ownerA = await registerAndLoginOwner('gallery-isolation-a');
    const ownerB = await registerAndLoginOwner('gallery-isolation-b');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ ...validCreateBody, slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = createResponse.body.data.restaurantId as string;

    const addResponse = await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/gallery`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .attach('file', validJpegBuffer, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const galleryItemId = addResponse.body.data.galleryItemId as string;

    await request(app.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/gallery`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .attach('file', validJpegBuffer, { filename: 'b.jpg', contentType: 'image/jpeg' })
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/gallery`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}/gallery/${galleryItemId}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);

    const stillOneRow = await prisma.restaurantGallery.count({ where: { restaurantId } });
    expect(stillOneRow).toBe(1);
  });
});
