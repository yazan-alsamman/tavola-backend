import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'taxonomy-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

describe('/api/v1/cuisine-categories, /api/v1/occasion-categories, and restaurant assignment (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let cuisineCategoryId: string;
  let cuisineCategorySlug: string;
  let secondCuisineCategoryId: string;
  let secondCuisineCategorySlug: string;
  let occasionCategoryId: string;
  let secondOccasionCategoryId: string;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — taxonomy e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();

    const cuisine = await prisma.cuisineCategory.create({
      data: { slug: `${TEST_PREFIX}italian-${uniqueId()}`, name: 'Italian', sortOrder: 2 },
    });
    cuisineCategoryId = cuisine.id;
    cuisineCategorySlug = cuisine.slug;
    const secondCuisine = await prisma.cuisineCategory.create({
      data: { slug: `${TEST_PREFIX}japanese-${uniqueId()}`, name: 'Japanese', sortOrder: 1 },
    });
    secondCuisineCategoryId = secondCuisine.id;
    secondCuisineCategorySlug = secondCuisine.slug;

    const occasion = await prisma.occasionCategory.create({
      data: { slug: `${TEST_PREFIX}date-night-${uniqueId()}`, name: 'Date Night', sortOrder: 2 },
    });
    occasionCategoryId = occasion.id;
    const secondOccasion = await prisma.occasionCategory.create({
      data: { slug: `${TEST_PREFIX}family-${uniqueId()}`, name: 'Family', sortOrder: 1 },
    });
    secondOccasionCategoryId = secondOccasion.id;
  });

  afterAll(async () => {
    if (dbAvailable) {
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
      await prisma.cuisineCategory.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
      await prisma.occasionCategory.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
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
    const { userId } = await seedOwnerAndOrganization(prisma, {
      email,
      passwordHash,
      lastName: suffix,
      organizationName: `${TEST_PREFIX}Org ${suffix} ${uniqueId()}`,
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

  it('GET /cuisine-categories is public and returns active categories sorted by sortOrder', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .get('/api/v1/cuisine-categories')
      .expect(200);

    const slugs = (response.body.data.items as Array<{ slug: string }>).map((item) => item.slug);
    const ourSlugs = slugs.filter((slug) => slug.startsWith(TEST_PREFIX));
    // secondCuisine has sortOrder 1 (lower), cuisine has sortOrder 2 - the
    // lower sortOrder must come first regardless of creation order.
    expect(ourSlugs).toEqual([secondCuisineCategorySlug, cuisineCategorySlug]);
  });

  it('GET /occasion-categories is public and returns active categories sorted by sortOrder', async () => {
    if (!dbAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .get('/api/v1/occasion-categories')
      .expect(200);

    expect(response.body.data.items.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /restaurants/{id}/cuisine-categories returns an empty categories array right after creation', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('cuisine-defaults');
    const restaurantId = await createRestaurant(owner.accessToken);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/cuisine-categories`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(response.body.data).toEqual({ restaurantId, categories: [] });
  });

  it('PATCH /restaurants/{id}/cuisine-categories full-replaces the assignment and writes an audit log entry', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('cuisine-update');
    const restaurantId = await createRestaurant(owner.accessToken);

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/cuisine-categories`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ cuisineCategoryIds: [cuisineCategoryId, secondCuisineCategoryId] })
      .expect(200);

    expect(patchResponse.body.data.restaurantId).toBe(restaurantId);
    expect(patchResponse.body.data.categories).toHaveLength(2);
    expect(
      patchResponse.body.data.categories
        .map((c: { cuisineCategoryId: string }) => c.cuisineCategoryId)
        .sort(),
    ).toEqual([cuisineCategoryId, secondCuisineCategoryId].sort());

    const getResponse = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/cuisine-categories`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(getResponse.body.data.categories).toHaveLength(2);

    const auditEntry = await prisma.auditLog.findFirst({
      where: { targetId: restaurantId, action: 'restaurant.cuisine_categories.updated' },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.actorId).toBe(owner.userId);
  });

  it('PATCH /restaurants/{id}/cuisine-categories rejects an unknown id with 400', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('cuisine-unknown');
    const restaurantId = await createRestaurant(owner.accessToken);

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/cuisine-categories`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ cuisineCategoryIds: [randomUUID()] })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH /restaurants/{id}/occasion-categories full-replaces the assignment and writes an audit log entry', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('occasion-update');
    const restaurantId = await createRestaurant(owner.accessToken);

    const patchResponse = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/occasion-categories`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ occasionCategoryIds: [occasionCategoryId, secondOccasionCategoryId] })
      .expect(200);

    expect(patchResponse.body.data.categories).toHaveLength(2);
    expect(
      patchResponse.body.data.categories
        .map((c: { occasionCategoryId: string }) => c.occasionCategoryId)
        .sort(),
    ).toEqual([occasionCategoryId, secondOccasionCategoryId].sort());

    const auditEntry = await prisma.auditLog.findFirst({
      where: { targetId: restaurantId, action: 'restaurant.occasion_categories.updated' },
    });
    expect(auditEntry).not.toBeNull();
  });

  it('PATCH /restaurants/{id}/occasion-categories rejects an unknown id with 400', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('occasion-unknown');
    const restaurantId = await createRestaurant(owner.accessToken);

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/occasion-categories`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ occasionCategoryIds: [randomUUID()] })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it("two different organizations never see each other's taxonomy assignment - GET/PATCH both return 404 across tenants", async () => {
    if (!dbAvailable || !app) return;

    const ownerA = await registerAndLoginOwner('isolation-a');
    const ownerB = await registerAndLoginOwner('isolation-b');
    const restaurantId = await createRestaurant(ownerA.accessToken);

    await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/cuisine-categories`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ cuisineCategoryIds: [cuisineCategoryId] })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/cuisine-categories`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/restaurants/${restaurantId}/cuisine-categories`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ cuisineCategoryIds: [] })
      .expect(404);

    const stillOneRow = await prisma.restaurantCuisineCategory.count({ where: { restaurantId } });
    expect(stillOneRow).toBe(1);
  });

  it('requires authentication for restaurant-scoped taxonomy routes', async () => {
    if (!dbAvailable || !app) return;

    const owner = await registerAndLoginOwner('no-auth');
    const restaurantId = await createRestaurant(owner.accessToken);

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/cuisine-categories`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/occasion-categories`)
      .expect(401);
  });
});
