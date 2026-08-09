import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TestingModule } from '@nestjs/testing';
import { PrismaPlatformAdminRepository } from '@modules/platform-admin/infrastructure/persistence/prisma-platform-admin.repository';
import { PlatformAdminRole } from '@modules/platform-admin/domain/enums/platform-admin.enums';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'pa_repo_it_';

/**
 * M6 remediation - `PrismaPlatformAdminRepository`'s CRUD methods
 * (create/list/findById/findByUserId/findActiveAdminContext/updateRole/
 * revoke/reactivate) had no integration coverage before this; only the
 * Restaurant lookup reader did. `PlatformAdmin` is not a
 * DIRECT_TENANT_OWNED_MODEL (TENANCY.md) - no TenantContext binding needed.
 */
describe('PrismaPlatformAdminRepository (integration)', () => {
  let moduleRef: TestingModule | undefined;
  let repository: PrismaPlatformAdminRepository;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — PrismaPlatformAdminRepository tests NOT EXECUTED.');
      return;
    }
    moduleRef = await createPrismaIntegrationModule([PrismaPlatformAdminRepository]);
    repository = moduleRef.get(PrismaPlatformAdminRepository);
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.platformAdmin.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  async function seedUser(suffix: string): Promise<string> {
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Platform',
        lastName: 'Admin',
        email: `${TEST_PREFIX}${suffix}-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    return userId;
  }

  it('creates a row and finds it by id and by userId', async () => {
    if (!dbAvailable) return;
    const userId = await seedUser('create');
    const platformAdminId = randomUUID();
    const now = new Date();

    await repository.create({
      id: platformAdminId,
      userId,
      role: PlatformAdminRole.PlatformSupport,
      createdAt: now,
      revokedAt: null,
    });

    const byId = await repository.findById(platformAdminId);
    expect(byId).toMatchObject({
      id: platformAdminId,
      userId,
      role: PlatformAdminRole.PlatformSupport,
    });
    const byUserId = await repository.findByUserId(userId);
    expect(byUserId).toMatchObject({
      id: platformAdminId,
      role: PlatformAdminRole.PlatformSupport,
    });
  });

  it('findActiveAdminContext returns the role for a non-revoked row and null for a revoked one', async () => {
    if (!dbAvailable) return;
    const activeUserId = await seedUser('active-ctx');
    const revokedUserId = await seedUser('revoked-ctx');
    const now = new Date();
    await repository.create({
      id: randomUUID(),
      userId: activeUserId,
      role: PlatformAdminRole.PlatformAdmin,
      createdAt: now,
      revokedAt: null,
    });
    await repository.create({
      id: randomUUID(),
      userId: revokedUserId,
      role: PlatformAdminRole.PlatformAdmin,
      createdAt: now,
      revokedAt: now,
    });

    await expect(repository.findActiveAdminContext(activeUserId)).resolves.toEqual({
      role: PlatformAdminRole.PlatformAdmin,
    });
    await expect(repository.findActiveAdminContext(revokedUserId)).resolves.toBeNull();
  });

  it('findActiveAdminContext returns null for an unknown userId', async () => {
    if (!dbAvailable) return;

    await expect(repository.findActiveAdminContext(randomUUID())).resolves.toBeNull();
  });

  it('list paginates in createdAt-descending order and reports the correct total', async () => {
    if (!dbAvailable) return;
    const suffix = randomUUID();
    const userIds = await Promise.all([
      seedUser(`list-a-${suffix}`),
      seedUser(`list-b-${suffix}`),
      seedUser(`list-c-${suffix}`),
    ]);
    const baseTime = Date.now();
    for (const [index, userId] of userIds.entries()) {
      await repository.create({
        id: randomUUID(),
        userId,
        role: PlatformAdminRole.PlatformSupport,
        createdAt: new Date(baseTime + index * 1000),
        revokedAt: null,
      });
    }

    const page = await repository.list(1, 2);

    expect(page.items).toHaveLength(2);
    expect(page.items[0].userId).toBe(userIds[2]);
    expect(page.items[1].userId).toBe(userIds[1]);
    expect(page.total).toBeGreaterThanOrEqual(3);
  });

  it('updateRole persists the new role', async () => {
    if (!dbAvailable) return;
    const userId = await seedUser('update-role');
    const platformAdminId = randomUUID();
    await repository.create({
      id: platformAdminId,
      userId,
      role: PlatformAdminRole.PlatformSupport,
      createdAt: new Date(),
      revokedAt: null,
    });

    await repository.updateRole(platformAdminId, PlatformAdminRole.PlatformAdmin, new Date());

    const updated = await repository.findById(platformAdminId);
    expect(updated?.role).toBe(PlatformAdminRole.PlatformAdmin);
  });

  it('revoke sets revokedAt and reactivate clears it back to null', async () => {
    if (!dbAvailable) return;
    const userId = await seedUser('revoke-reactivate');
    const platformAdminId = randomUUID();
    await repository.create({
      id: platformAdminId,
      userId,
      role: PlatformAdminRole.PlatformAdmin,
      createdAt: new Date(),
      revokedAt: null,
    });

    const revokedAt = new Date();
    await repository.revoke(platformAdminId, revokedAt);
    const revoked = await repository.findById(platformAdminId);
    expect(revoked?.revokedAt).toEqual(revokedAt);

    await repository.reactivate(platformAdminId);
    const reactivated = await repository.findById(platformAdminId);
    expect(reactivated?.revokedAt).toBeNull();
  });
});
