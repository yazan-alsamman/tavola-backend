import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaOrganizationRepository } from '@modules/organizations/infrastructure/persistence/prisma-organization.repository';
import { OrganizationStatus } from '@modules/organizations/domain/enums/organization.enums';
import { OrganizationId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'org-delete-restore-';

/**
 * Phase 19.4 (ADR-034 §4) - proves `Organization.softDelete()`/`restore()`
 * persist correctly through the real `PrismaOrganizationRepository`, that
 * deletion never cascades to child Restaurant/OrganizationMember rows (no
 * cascade, ever - §5, extended from Suspend's identical rule), and that
 * historical business data survives a delete+restore cycle untouched.
 */
describe('PrismaOrganizationRepository Delete/Restore (integration, real Postgres)', () => {
  let dbAvailable = false;
  let repository: PrismaOrganizationRepository;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaOrganizationRepository]);
    repository = moduleRef.get(PrismaOrganizationRepository);
  });

  afterAll(async () => {
    if (dbAvailable) {
      await rawPrisma.restaurant.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
      await rawPrisma.organizationMember.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await rawPrisma.organization.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
      await rawPrisma.$disconnect();
    }
  });

  async function seedOrg(suffix: string): Promise<{ id: string; ownerId: string }> {
    const id = randomUUID();
    await rawPrisma.organization.create({
      data: {
        id,
        name: `${TEST_PREFIX}${suffix}-${randomUUID()}`,
        slug: `${TEST_PREFIX}${suffix}-${randomUUID()}`,
        status: 'Active',
        billingEmail: `${TEST_PREFIX}${suffix}@example.com`,
      },
    });
    const ownerId = randomUUID();
    await rawPrisma.user.create({
      data: {
        id: ownerId,
        firstName: 'Owner',
        lastName: suffix,
        email: `${TEST_PREFIX}owner-${suffix}-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    await rawPrisma.organizationMember.create({
      data: {
        id: randomUUID(),
        organizationId: id,
        userId: ownerId,
        role: 'Owner',
        status: 'Active',
        invitedAt: new Date(),
        joinedAt: new Date(),
      },
    });
    return { id, ownerId };
  }

  it('soft-deletes: deletedAt persists, status is left untouched', async () => {
    if (!dbAvailable) return;
    const { id } = await seedOrg('basic-delete');

    const organization = await repository.findById(OrganizationId.create(id));
    const now = new Date('2026-08-10T12:00:00.000Z');
    await repository.save(organization!.softDelete(now));

    const row = await rawPrisma.organization.findUnique({ where: { id } });
    expect(row?.deletedAt).toEqual(now);
    expect(row?.status).toBe('Active');
  });

  it('never cascades to a child Restaurant on delete (no cascade, ever - ADR-034 §5)', async () => {
    if (!dbAvailable) return;
    const { id } = await seedOrg('cascade-check');
    const restaurantId = randomUUID();
    await rawPrisma.restaurant.create({
      data: {
        id: restaurantId,
        organizationId: id,
        name: `${TEST_PREFIX}restaurant-${randomUUID()}`,
        slug: `${TEST_PREFIX}restaurant-${randomUUID()}`,
        status: 'Active',
      },
    });

    const organization = await repository.findById(OrganizationId.create(id));
    await repository.save(organization!.softDelete(new Date()));

    const restaurant = await rawPrisma.restaurant.findUnique({ where: { id: restaurantId } });
    expect(restaurant?.status).toBe('Active');
    expect(restaurant?.deletedAt).toBeNull();
  });

  it('restore clears deletedAt; a Suspended-and-deleted Organization restores back to Suspended, not Active', async () => {
    if (!dbAvailable) return;
    const { id } = await seedOrg('suspended-restore');

    let organization = await repository.findById(OrganizationId.create(id));
    organization = organization!.suspend(new Date());
    await repository.save(organization);
    organization = organization.softDelete(new Date());
    await repository.save(organization);

    const deletedRow = await rawPrisma.organization.findUnique({ where: { id } });
    expect(deletedRow?.deletedAt).not.toBeNull();
    expect(deletedRow?.status).toBe('Suspended');

    const restored = organization.restore(new Date());
    await repository.save(restored);

    const restoredRow = await rawPrisma.organization.findUnique({ where: { id } });
    expect(restoredRow?.deletedAt).toBeNull();
    expect(restoredRow?.status).toBe('Suspended');
  });

  it('re-applying softDelete on an already-deleted Organization just re-stamps deletedAt (matches Restaurant Delete precedent, no error)', async () => {
    if (!dbAvailable) return;
    const { id } = await seedOrg('reapply-delete');
    const first = new Date('2026-08-01T00:00:00.000Z');
    const second = new Date('2026-08-05T00:00:00.000Z');

    let organization = await repository.findById(OrganizationId.create(id));
    await repository.save(organization!.softDelete(first));
    organization = await repository.findById(OrganizationId.create(id));
    await repository.save(organization!.softDelete(second));

    const row = await rawPrisma.organization.findUnique({ where: { id } });
    expect(row?.deletedAt).toEqual(second);
  });

  it('historical OrganizationMember data survives a delete+restore cycle untouched', async () => {
    if (!dbAvailable) return;
    const { id, ownerId } = await seedOrg('history-preserved');

    let organization = await repository.findById(OrganizationId.create(id));
    await repository.save(organization!.softDelete(new Date()));
    organization = await repository.findById(OrganizationId.create(id));
    await repository.save(organization!.restore(new Date()));

    const member = await rawPrisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: id, userId: ownerId } },
    });
    expect(member?.role).toBe('Owner');
    expect(member?.status).toBe('Active');
  });

  it('findById already returns a soft-deleted Organization (no exclusion filter) - a pre-existing repository characteristic, not introduced by this phase', async () => {
    if (!dbAvailable) return;
    const { id } = await seedOrg('find-includes-deleted');
    const organization = await repository.findById(OrganizationId.create(id));
    await repository.save(organization!.softDelete(new Date()));

    const found = await repository.findById(OrganizationId.create(id));
    expect(found).not.toBeNull();
    expect(found!.isSoftDeleted()).toBe(true);
  });

  it('OrganizationStatus.Closed is never written by Delete - status stays whatever it was before deletion', async () => {
    if (!dbAvailable) return;
    const { id } = await seedOrg('never-closed');

    const organization = await repository.findById(OrganizationId.create(id));
    await repository.save(organization!.softDelete(new Date()));

    const row = await rawPrisma.organization.findUnique({ where: { id } });
    expect(row?.status).not.toBe(OrganizationStatus.Closed);
    expect(row?.status).toBe('Active');
  });
});
