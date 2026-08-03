import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Client as MinioClient } from 'minio';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import {
  isDatabaseReachable,
  isMinioReachable,
  resolveTestMinioConfig,
  skipUnlessDatabaseAvailable,
} from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'menu-image-e2e-';
const PASSWORD = 'SecurePass123!';
const BUCKET = process.env.MINIO_PUBLIC_BUCKET ?? 'tavla-public';

const validJpegBuffer = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)]);
const validPngBuffer = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0),
]);

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 18 (Menu Management, ADR-031 decision #5) - real MinIO/PostgreSQL
 * verification for Category/Item image upload/replace/remove, mirroring
 * `avatar-upload.e2e-spec.ts`'s exact pattern (no mocks): a `FileRecord` is
 * genuinely created with the correct `ownerId`/`ownerType`, the returned
 * signed URL genuinely resolves against the real bucket, a replace both
 * soft-deletes the prior `FileRecord` row AND removes the prior object from
 * MinIO itself (orphan cleanup), and a remove clears the owner's
 * `imageFileId` and is reflected on the public read.
 */
describe('Menu Category/Item image upload (e2e, MinIO, Phase 18)', () => {
  let app: INestApplication | undefined;
  let infraAvailable = false;
  let passwordHash = 'argon2id$test';
  let minioClient: MinioClient;

  beforeAll(async () => {
    const [dbAvailable, minioAvailable] = await Promise.all([
      isDatabaseReachable(),
      isMinioReachable(),
    ]);
    infraAvailable = dbAvailable && minioAvailable;
    if (skipUnlessDatabaseAvailable(infraAvailable)) {
      console.warn('PostgreSQL/MinIO not reachable — menu image e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    minioClient = new MinioClient(resolveTestMinioConfig());
    app = await createTestApp();
  });

  afterAll(async () => {
    try {
      if (infraAvailable) {
        const restaurants = await prisma.restaurant.findMany({
          where: { slug: { startsWith: TEST_PREFIX } },
          select: { id: true },
        });
        const restaurantIds = restaurants.map((r) => r.id);

        // Remove any objects this suite uploaded under menus/categories/**
        // and menus/items/** for these restaurants' own categories/items,
        // then their FileRecord rows, mirroring avatar-upload's own
        // bucket-prefix-scan cleanup pattern.
        const categories = await prisma.menuCategory.findMany({
          where: { restaurantId: { in: restaurantIds } },
          select: { id: true },
        });
        const items = await prisma.menuItem.findMany({
          where: { restaurantId: { in: restaurantIds } },
          select: { id: true },
        });
        for (const category of categories) {
          await removeAllObjects(minioClient, `menus/categories/${category.id}/`);
        }
        for (const item of items) {
          await removeAllObjects(minioClient, `menus/items/${item.id}/`);
        }
        await prisma.file.deleteMany({
          where: { ownerId: { in: [...categories.map((c) => c.id), ...items.map((i) => i.id)] } },
        });

        await prisma.menuItemOption.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
        await prisma.menuItemOptionGroup.deleteMany({
          where: { restaurantId: { in: restaurantIds } },
        });
        await prisma.menuItemAddOn.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
        await prisma.menuItemAvailability.deleteMany({
          where: { restaurantId: { in: restaurantIds } },
        });
        await prisma.menuItem.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
        await prisma.menuCategory.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
        await prisma.menu.deleteMany({ where: { restaurantId: { in: restaurantIds } } });
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
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  async function removeAllObjects(client: MinioClient, prefix: string): Promise<void> {
    const keys: string[] = await new Promise((resolve, reject) => {
      const collected: string[] = [];
      const stream = client.listObjectsV2(BUCKET, prefix, true);
      stream.on('data', (obj) => {
        if (obj.name) collected.push(obj.name);
      });
      stream.on('end', () => resolve(collected));
      stream.on('error', reject);
    });
    for (const key of keys) {
      await client.removeObject(BUCKET, key).catch(() => undefined);
    }
  }

  async function objectExists(objectKey: string): Promise<boolean> {
    try {
      await minioClient.statObject(BUCKET, objectKey);
      return true;
    } catch {
      return false;
    }
  }

  async function registerAndLoginOwner(suffix: string): Promise<{ accessToken: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    await seedOwnerAndOrganization(prisma, {
      email,
      passwordHash,
      lastName: suffix,
      organizationName: `${TEST_PREFIX}Org ${suffix} ${uniqueId()}`,
    });
    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    return { accessToken: loginResponse.body.data.accessToken as string };
  }

  async function setUpMenuCategoryAndItem(
    accessToken: string,
  ): Promise<{ restaurantId: string; menuId: string; categoryId: string; itemId: string }> {
    const auth = { Authorization: `Bearer ${accessToken}` };
    const restaurantResponse = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set(auth)
      .send({ name: 'Menu Image Bistro', slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    const restaurantId = restaurantResponse.body.data.restaurantId as string;

    const menuResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus`)
      .set(auth)
      .send({ name: 'Main' })
      .expect(201);
    const menuId = menuResponse.body.data.id as string;

    const categoryResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories`)
      .set(auth)
      .send({ name: 'Pizzas' })
      .expect(201);
    const categoryId = categoryResponse.body.data.id as string;

    const itemResponse = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items`)
      .set(auth)
      .send({ name: 'Margherita', price: 12.5 })
      .expect(201);
    const itemId = itemResponse.body.data.id as string;

    return { restaurantId, menuId, categoryId, itemId };
  }

  describe('Category image', () => {
    it('uploads a JPEG image: creates a FileRecord owned by the Category, returns a resolvable signed URL, reflected on the public read', async () => {
      if (!infraAvailable || !app) return;
      const owner = await registerAndLoginOwner('cat-upload');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const { restaurantId, menuId, categoryId } = await setUpMenuCategoryAndItem(
        owner.accessToken,
      );

      const uploadResponse = await request(app.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/image`)
        .set(auth)
        .attach('file', validJpegBuffer, { filename: 'category.jpg', contentType: 'image/jpeg' })
        .expect(200);
      const imageUrl = uploadResponse.body.data.imageUrl as string;
      expect(imageUrl).toContain(BUCKET);

      // FileRecord ownership.
      const fileRecord = await prisma.file.findFirst({
        where: { ownerId: categoryId, ownerType: 'Menu' },
      });
      expect(fileRecord).not.toBeNull();
      expect(fileRecord?.mimeType).toBe('image/jpeg');
      expect(fileRecord?.bucket).toBe(BUCKET);
      expect(await objectExists(fileRecord!.objectKey)).toBe(true);

      // Category row points at it.
      const categoryRow = await prisma.menuCategory.findUnique({ where: { id: categoryId } });
      expect(categoryRow?.imageFileId).toBe(fileRecord?.id);

      // Signed URL genuinely resolves (real MinIO, real HTTP fetch).
      const objectResponse = await fetch(imageUrl);
      expect(objectResponse.status).toBe(200);

      // Public read reflects it.
      const publicRead = await request(app.getHttpServer())
        .get(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}`)
        .expect(200);
      expect(publicRead.body.data.imageUrl).toContain(BUCKET);
    });

    it('replacing the image soft-deletes the prior FileRecord AND removes the prior object from MinIO (orphan cleanup)', async () => {
      if (!infraAvailable || !app) return;
      const owner = await registerAndLoginOwner('cat-replace');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const { restaurantId, menuId, categoryId } = await setUpMenuCategoryAndItem(
        owner.accessToken,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/image`)
        .set(auth)
        .attach('file', validJpegBuffer, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(200);
      const firstFile = await prisma.file.findFirst({ where: { ownerId: categoryId } });

      await request(app.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/image`)
        .set(auth)
        .attach('file', validPngBuffer, { filename: 'b.png', contentType: 'image/png' })
        .expect(200);

      const secondFile = await prisma.file.findFirst({
        where: { ownerId: categoryId, deletedAt: null },
      });
      expect(secondFile?.id).not.toBe(firstFile?.id);

      const reloadedFirstFile = await prisma.file.findUnique({ where: { id: firstFile!.id } });
      expect(reloadedFirstFile?.deletedAt).not.toBeNull();
      expect(await objectExists(firstFile!.objectKey)).toBe(false);
      expect(await objectExists(secondFile!.objectKey)).toBe(true);

      const categoryRow = await prisma.menuCategory.findUnique({ where: { id: categoryId } });
      expect(categoryRow?.imageFileId).toBe(secondFile?.id);
    });

    it('removing the image clears imageFileId, soft-deletes the FileRecord, deletes the MinIO object, and the public read shows no image', async () => {
      if (!infraAvailable || !app) return;
      const owner = await registerAndLoginOwner('cat-remove');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const { restaurantId, menuId, categoryId } = await setUpMenuCategoryAndItem(
        owner.accessToken,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/image`)
        .set(auth)
        .attach('file', validJpegBuffer, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(200);
      const fileRecord = await prisma.file.findFirst({ where: { ownerId: categoryId } });

      await request(app.getHttpServer())
        .delete(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/image`,
        )
        .set(auth)
        .expect(204);

      const categoryRow = await prisma.menuCategory.findUnique({ where: { id: categoryId } });
      expect(categoryRow?.imageFileId).toBeNull();

      const reloadedFile = await prisma.file.findUnique({ where: { id: fileRecord!.id } });
      expect(reloadedFile?.deletedAt).not.toBeNull();
      expect(await objectExists(fileRecord!.objectKey)).toBe(false);

      const publicRead = await request(app.getHttpServer())
        .get(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}`)
        .expect(200);
      expect(publicRead.body.data.imageUrl).toBeNull();
    });

    it('rejects a missing file (400) and an unsupported file type (400 - fails magic-byte detection)', async () => {
      if (!infraAvailable || !app) return;
      const owner = await registerAndLoginOwner('cat-invalid');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const { restaurantId, menuId, categoryId } = await setUpMenuCategoryAndItem(
        owner.accessToken,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/image`)
        .set(auth)
        .expect(400);

      const gifBuffer = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(16, 0)]);
      await request(app.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/image`)
        .set(auth)
        .attach('file', gifBuffer, { filename: 'a.gif', contentType: 'image/gif' })
        .expect(400);
    });
  });

  describe('Item image', () => {
    it('uploads a JPEG image: creates a FileRecord owned by the Item, returns a resolvable signed URL, reflected on the public read', async () => {
      if (!infraAvailable || !app) return;
      const owner = await registerAndLoginOwner('item-upload');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const { restaurantId, menuId, categoryId, itemId } = await setUpMenuCategoryAndItem(
        owner.accessToken,
      );

      const uploadResponse = await request(app.getHttpServer())
        .post(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/image`,
        )
        .set(auth)
        .attach('file', validJpegBuffer, { filename: 'item.jpg', contentType: 'image/jpeg' })
        .expect(200);
      const imageUrl = uploadResponse.body.data.imageUrl as string;
      expect(imageUrl).toContain(BUCKET);

      const fileRecord = await prisma.file.findFirst({
        where: { ownerId: itemId, ownerType: 'Menu' },
      });
      expect(fileRecord).not.toBeNull();
      expect(fileRecord?.bucket).toBe(BUCKET);
      expect(await objectExists(fileRecord!.objectKey)).toBe(true);

      const itemRow = await prisma.menuItem.findUnique({ where: { id: itemId } });
      expect(itemRow?.imageFileId).toBe(fileRecord?.id);

      const objectResponse = await fetch(imageUrl);
      expect(objectResponse.status).toBe(200);

      const publicRead = await request(app.getHttpServer())
        .get(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}`,
        )
        .expect(200);
      expect(publicRead.body.data.imageUrl).toContain(BUCKET);
    });

    it('replacing the image soft-deletes the prior FileRecord AND removes the prior object from MinIO (orphan cleanup)', async () => {
      if (!infraAvailable || !app) return;
      const owner = await registerAndLoginOwner('item-replace');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const { restaurantId, menuId, categoryId, itemId } = await setUpMenuCategoryAndItem(
        owner.accessToken,
      );

      const itemImagePath = `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/image`;
      await request(app.getHttpServer())
        .post(itemImagePath)
        .set(auth)
        .attach('file', validJpegBuffer, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(200);
      const firstFile = await prisma.file.findFirst({ where: { ownerId: itemId } });

      await request(app.getHttpServer())
        .post(itemImagePath)
        .set(auth)
        .attach('file', validPngBuffer, { filename: 'b.png', contentType: 'image/png' })
        .expect(200);

      const secondFile = await prisma.file.findFirst({
        where: { ownerId: itemId, deletedAt: null },
      });
      expect(secondFile?.id).not.toBe(firstFile?.id);

      const reloadedFirstFile = await prisma.file.findUnique({ where: { id: firstFile!.id } });
      expect(reloadedFirstFile?.deletedAt).not.toBeNull();
      expect(await objectExists(firstFile!.objectKey)).toBe(false);
      expect(await objectExists(secondFile!.objectKey)).toBe(true);
    });

    it('removing the image clears imageFileId, soft-deletes the FileRecord, deletes the MinIO object, and the public read shows no image', async () => {
      if (!infraAvailable || !app) return;
      const owner = await registerAndLoginOwner('item-remove');
      const auth = { Authorization: `Bearer ${owner.accessToken}` };
      const { restaurantId, menuId, categoryId, itemId } = await setUpMenuCategoryAndItem(
        owner.accessToken,
      );
      const itemImagePath = `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/image`;

      await request(app.getHttpServer())
        .post(itemImagePath)
        .set(auth)
        .attach('file', validJpegBuffer, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(200);
      const fileRecord = await prisma.file.findFirst({ where: { ownerId: itemId } });

      await request(app.getHttpServer()).delete(itemImagePath).set(auth).expect(204);

      const itemRow = await prisma.menuItem.findUnique({ where: { id: itemId } });
      expect(itemRow?.imageFileId).toBeNull();

      const reloadedFile = await prisma.file.findUnique({ where: { id: fileRecord!.id } });
      expect(reloadedFile?.deletedAt).not.toBeNull();
      expect(await objectExists(fileRecord!.objectKey)).toBe(false);

      const publicRead = await request(app.getHttpServer())
        .get(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}`,
        )
        .expect(200);
      expect(publicRead.body.data.imageUrl).toBeNull();
    });

    it('cross-organization image upload is denied (IDOR-safe 404)', async () => {
      if (!infraAvailable || !app) return;
      const ownerA = await registerAndLoginOwner('item-cross-a');
      const ownerB = await registerAndLoginOwner('item-cross-b');
      const { restaurantId, menuId, categoryId, itemId } = await setUpMenuCategoryAndItem(
        ownerA.accessToken,
      );

      await request(app.getHttpServer())
        .post(
          `/api/v1/restaurants/${restaurantId}/menus/${menuId}/categories/${categoryId}/items/${itemId}/image`,
        )
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .attach('file', validJpegBuffer, { filename: 'a.jpg', contentType: 'image/jpeg' })
        .expect(404);
    });
  });
});
