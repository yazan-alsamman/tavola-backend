import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaOrganizationMemberRepository } from '@modules/organizations/infrastructure/persistence/prisma-organization-member.repository';
import { OrganizationMember } from '@modules/organizations/domain/entities/organization-member.entity';
import {
  OrganizationMemberRole,
  OrganizationMemberStatus,
} from '@modules/organizations/domain/enums/organization.enums';
import { OrganizationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { TenantContextMissingException } from '@infrastructure/tenancy/tenant-context-missing.exception';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * Phase 2.13.1 — proves tenant enforcement through the actual DI-wired
 * `PrismaOrganizationMemberRepository` (via `PrismaContext`), not just the
 * `withTenantScoping` extension in isolation (already covered by
 * test/tenancy/prisma-tenant-scoping.integration-spec.ts). This is the gap
 * Phase 2.13 left open: the extension was proven correct, but nothing proved
 * a real repository built on `PrismaContext` actually benefits from it.
 */

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'org-member-repo-tenancy-';

describe('PrismaOrganizationMemberRepository tenant enforcement (integration)', () => {
  let dbAvailable = false;
  let repository: PrismaOrganizationMemberRepository;
  let tenantContextService: TenantContextService;

  let orgA: { id: string };
  let orgB: { id: string };
  let memberA: { id: string; userId: string };
  let memberB: { id: string; userId: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaOrganizationMemberRepository]);
    repository = moduleRef.get(PrismaOrganizationMemberRepository);
    tenantContextService = moduleRef.get(TenantContextService);

    orgA = await rawPrisma.organization.create({
      data: {
        name: 'Repo Tenancy Org A',
        slug: `${TEST_PREFIX}org-a-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}a@example.com`,
      },
    });
    orgB = await rawPrisma.organization.create({
      data: {
        name: 'Repo Tenancy Org B',
        slug: `${TEST_PREFIX}org-b-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}b@example.com`,
      },
    });

    const userA = await rawPrisma.user.create({
      data: {
        firstName: 'Repo',
        lastName: 'A',
        email: `${TEST_PREFIX}user-a-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    const userB = await rawPrisma.user.create({
      data: {
        firstName: 'Repo',
        lastName: 'B',
        email: `${TEST_PREFIX}user-b-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });

    memberA = await rawPrisma.organizationMember.create({
      data: { organizationId: orgA.id, userId: userA.id, role: 'Owner', status: 'Active' },
    });
    // Org B's only member is deliberately NOT an active Owner: the DB has a
    // partial unique index (one active Owner per organization_id), so
    // countActiveOwners' true values for A (1) and B (0) must differ for the
    // isolation assertions below to distinguish "correctly scoped to the
    // bound tenant" from a hypothetical bug that trusts the caller's
    // organizationId parameter instead.
    memberB = await rawPrisma.organizationMember.create({
      data: { organizationId: orgB.id, userId: userB.id, role: 'Staff', status: 'Active' },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;

    await rawPrisma.organizationMember.deleteMany({
      where: { organization: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  function asOrgA<T>(fn: () => Promise<T>): Promise<T> {
    return tenantContextService.runAsync(
      { organizationId: orgA.id, userId: null, correlationId: 'repo-test-a' },
      fn,
    );
  }

  function asOrgB<T>(fn: () => Promise<T>): Promise<T> {
    return tenantContextService.runAsync(
      { organizationId: orgB.id, userId: null, correlationId: 'repo-test-b' },
      fn,
    );
  }

  it("findByOrganizationAndUser never resolves another tenant's member row, even when queried by that member's own userId under the wrong tenant context", async () => {
    if (!dbAvailable) return;

    const foundAsA = await asOrgA(() =>
      repository.findByOrganizationAndUser(
        OrganizationId.create(orgB.id),
        UserId.create(memberB.userId),
      ),
    );
    expect(foundAsA).toBeNull();

    const foundCorrectly = await asOrgB(() =>
      repository.findByOrganizationAndUser(
        OrganizationId.create(orgB.id),
        UserId.create(memberB.userId),
      ),
    );
    expect(foundCorrectly).not.toBeNull();
    expect(foundCorrectly?.toProps().id).toBe(memberB.id);
  });

  it('countActiveOwners scopes the count to the bound tenant, not the requested organizationId parameter', async () => {
    if (!dbAvailable) return;

    // The method is CALLED with orgB.id as the parameter in both cases, but
    // the bound context always wins (tenant-scoped-prisma.extension.ts) -
    // Org A's true count (1, from memberA) and Org B's true count (0, since
    // memberB is Staff, not an active Owner) must differ for this to prove
    // anything: a hypothetical bug that trusted the parameter instead of the
    // bound context would return Org B's count (0) for BOTH calls below.
    const countAsA = await asOrgA(() =>
      repository.countActiveOwners(OrganizationId.create(orgB.id)),
    );
    expect(countAsA).toBe(1);

    const countAsB = await asOrgB(() =>
      repository.countActiveOwners(OrganizationId.create(orgB.id)),
    );
    expect(countAsB).toBe(0);
  });

  it('findOwner scopes to the bound tenant, not the requested organizationId parameter (M6 remediation)', async () => {
    if (!dbAvailable) return;

    // Called with orgB.id as the parameter in both cases - the bound
    // context always wins. Org A has an Active Owner (memberA); Org B does
    // not (memberB is Staff) - the two calls must differ for this to prove
    // anything, exactly like the countActiveOwners case above.
    const ownerAsA = await asOrgA(() => repository.findOwner(OrganizationId.create(orgB.id)));
    expect(ownerAsA?.toProps().id).toBe(memberA.id);

    const ownerAsB = await asOrgB(() => repository.findOwner(OrganizationId.create(orgB.id)));
    expect(ownerAsB).toBeNull();
  });

  it('save() cannot create or update a member row under another tenant even when the domain entity carries that organizationId', async () => {
    if (!dbAvailable) return;

    const user = await rawPrisma.user.create({
      data: {
        firstName: 'Spoof',
        lastName: 'Target',
        email: `${TEST_PREFIX}spoof-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });

    // Staff, not Owner: Org A already has an active Owner (memberA), and the
    // database enforces at most one active Owner per organization (a
    // separate business invariant, not part of tenant scoping) - using
    // Owner here would conflict with that invariant regardless of tenancy
    // and prove nothing about organizationId override specifically.
    const memberForOrgB = OrganizationMember.create({
      id: randomUUID(),
      organizationId: orgB.id,
      userId: user.id,
      role: OrganizationMemberRole.Staff,
      status: OrganizationMemberStatus.Active,
      invitedAt: new Date(),
      joinedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Bound to Org A while the entity itself says Org B - the tenant-scoped
    // client must override organizationId on the write, not trust the
    // caller-supplied value (Phase 2.13's tenant-spoofing guarantee, now
    // proven through the real repository rather than the extension alone).
    const created = await asOrgA(() => repository.save(memberForOrgB));
    void created;

    const persisted = await rawPrisma.organizationMember.findFirst({ where: { userId: user.id } });
    expect(persisted?.organizationId).toBe(orgA.id);
    expect(persisted?.organizationId).not.toBe(orgB.id);
  });

  it('throws TenantContextMissingException instead of running unscoped when no TenantContext is bound', async () => {
    if (!dbAvailable) return;

    await expect(
      repository.findByOrganizationAndUser(
        OrganizationId.create(orgA.id),
        UserId.create(memberA.userId),
      ),
    ).rejects.toBeInstanceOf(TenantContextMissingException);

    await expect(
      repository.countActiveOwners(OrganizationId.create(orgA.id)),
    ).rejects.toBeInstanceOf(TenantContextMissingException);

    await expect(repository.findOwner(OrganizationId.create(orgA.id))).rejects.toBeInstanceOf(
      TenantContextMissingException,
    );
  });

  it('keeps concurrent Org A / Org B repository reads isolated under real concurrent DB I/O', async () => {
    if (!dbAvailable) return;

    const iterations = 6;
    const calls: Promise<void>[] = [];

    for (let i = 0; i < iterations; i += 1) {
      calls.push(
        asOrgA(async () => {
          const count = await repository.countActiveOwners(OrganizationId.create(orgA.id));
          expect(count).toBe(1);
        }),
      );
      calls.push(
        asOrgB(async () => {
          const count = await repository.countActiveOwners(OrganizationId.create(orgB.id));
          expect(count).toBe(0);
        }),
      );
    }

    await Promise.all(calls);
  });
});
