import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { withTenantScoping } from '@infrastructure/tenancy/tenant-scoped-prisma.extension';
import { TenantContextMissingException } from '@infrastructure/tenancy/tenant-context-missing.exception';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

/**
 * The extension injects `organizationId` at runtime, invisibly to Prisma's
 * generated static types for `.create()` — its `data` argument's type still
 * statically requires `organizationId` (or a nested `organization` relation)
 * since extensions don't retype the base CRUD input types. This test-only
 * cast documents that gap rather than fighting it with a fragile relation
 * payload; production repositories built on this client would face the same
 * friction and should use the same pattern.
 */
interface ScopedRestaurantCreateData {
  name: string;
  slug: string;
  status: string;
  organizationId?: string;
}

function asRestaurantCreateInput(
  data: ScopedRestaurantCreateData,
): Prisma.RestaurantUncheckedCreateInput {
  return data as unknown as Prisma.RestaurantUncheckedCreateInput;
}

/**
 * CRITICAL PRISMA SECURITY TESTS (Phase 2.13) — proves the tenant-scoped
 * Prisma Client Extension (TENANCY.md, ADR-012) against real PostgreSQL, per
 * TENANCY.md's own stated testing requirement: every tenant-owned-model
 * query must be proven (1) never leaking cross-tenant rows, and (2) throwing
 * TenantContextMissingException with no context bound.
 *
 * Organization/Restaurant test rows are seeded directly via the RAW
 * (unextended) client — bootstrap-style, exactly like
 * test/database/schema.integration-spec.ts — since no business module wires
 * these repositories to the scoped client yet (see Phase 2.13 report).
 */

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'tenancy-scoping-';

describe('Tenant-scoped Prisma Client Extension (integration)', () => {
  let dbAvailable = false;
  let tenantContextService: TenantContextService;
  let scoped: ReturnType<typeof withTenantScoping<PrismaClient>>;

  let orgA: { id: string; slug: string };
  let orgB: { id: string; slug: string };
  let restaurantA: { id: string };
  let restaurantB: { id: string };
  let memberA: { id: string; userId: string };
  let memberB: { id: string; userId: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    tenantContextService = new TenantContextService();
    scoped = withTenantScoping(rawPrisma, tenantContextService);

    orgA = await rawPrisma.organization.create({
      data: {
        name: 'Tenancy Org A',
        slug: `${TEST_PREFIX}org-a-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}a@example.com`,
      },
    });
    orgB = await rawPrisma.organization.create({
      data: {
        name: 'Tenancy Org B',
        slug: `${TEST_PREFIX}org-b-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}b@example.com`,
      },
    });
    restaurantA = await rawPrisma.restaurant.create({
      data: {
        organizationId: orgA.id,
        name: 'Restaurant A',
        slug: `${TEST_PREFIX}restaurant-a-${randomUUID()}`,
        status: 'Active',
      },
    });
    restaurantB = await rawPrisma.restaurant.create({
      data: {
        organizationId: orgB.id,
        name: 'Restaurant B',
        slug: `${TEST_PREFIX}restaurant-b-${randomUUID()}`,
        status: 'Active',
      },
    });

    const userA = await rawPrisma.user.create({
      data: {
        firstName: 'Member',
        lastName: 'A',
        email: `${TEST_PREFIX}member-a-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    const userB = await rawPrisma.user.create({
      data: {
        firstName: 'Member',
        lastName: 'B',
        email: `${TEST_PREFIX}member-b-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    memberA = await rawPrisma.organizationMember.create({
      data: { organizationId: orgA.id, userId: userA.id, role: 'Owner', status: 'Active' },
    });
    memberB = await rawPrisma.organizationMember.create({
      data: { organizationId: orgB.id, userId: userB.id, role: 'Owner', status: 'Active' },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;

    await rawPrisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organizationMember.deleteMany({
      where: { organization: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  function asOrgA<T>(fn: () => Promise<T>): Promise<T> {
    return tenantContextService.runAsync(
      { organizationId: orgA.id, userId: null, correlationId: 'test-a' },
      fn,
    );
  }

  function asOrgB<T>(fn: () => Promise<T>): Promise<T> {
    return tenantContextService.runAsync(
      { organizationId: orgB.id, userId: null, correlationId: 'test-b' },
      fn,
    );
  }

  it("scopes findMany to the bound tenant, never returning another tenant's rows", async () => {
    if (!dbAvailable) return;

    const restaurantsAsA = await asOrgA(() =>
      scoped.restaurant.findMany({ where: { slug: { startsWith: TEST_PREFIX } } }),
    );

    expect(restaurantsAsA.map((r) => r.id)).toContain(restaurantA.id);
    expect(restaurantsAsA.map((r) => r.id)).not.toContain(restaurantB.id);
  });

  it("scopes findUnique so another tenant's row by id resolves to null", async () => {
    if (!dbAvailable) return;

    const found = await asOrgA(() =>
      scoped.restaurant.findUnique({ where: { id: restaurantB.id } }),
    );

    expect(found).toBeNull();
  });

  it("blocks cross-tenant update — another tenant's row is never modified", async () => {
    if (!dbAvailable) return;

    // Asserting the specific "record not found" failure (not just "rejects
    // with something") matters here: a context-propagation bug that causes
    // TenantContextMissingException to be thrown instead would ALSO make a
    // bare `.rejects.toThrow()` pass, silently masking the real regression.
    await expect(
      asOrgA(() =>
        scoped.restaurant.update({
          where: { id: restaurantB.id },
          data: { name: 'HACKED BY ORG A' },
        }),
      ),
    ).rejects.not.toBeInstanceOf(TenantContextMissingException);
    await expect(
      asOrgA(() =>
        scoped.restaurant.update({
          where: { id: restaurantB.id },
          data: { name: 'HACKED BY ORG A' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2025' });

    const unchanged = await rawPrisma.restaurant.findUnique({ where: { id: restaurantB.id } });
    expect(unchanged?.name).toBe('Restaurant B');
  });

  it("blocks cross-tenant delete — another tenant's row is never removed", async () => {
    if (!dbAvailable) return;

    await expect(
      asOrgA(() => scoped.restaurant.delete({ where: { id: restaurantB.id } })),
    ).rejects.toMatchObject({ code: 'P2025' });

    const stillExists = await rawPrisma.restaurant.findUnique({ where: { id: restaurantB.id } });
    expect(stillExists).not.toBeNull();
  });

  it('auto-injects organizationId from the bound context on create', async () => {
    if (!dbAvailable) return;

    const created = await asOrgA(() =>
      scoped.restaurant.create({
        data: asRestaurantCreateInput({
          name: 'Auto-Scoped Restaurant',
          slug: `${TEST_PREFIX}auto-${randomUUID()}`,
          status: 'Active',
        }),
      }),
    );

    expect(created.organizationId).toBe(orgA.id);
  });

  it('never lets a client-supplied organizationId override the bound tenant context', async () => {
    if (!dbAvailable) return;

    const created = await asOrgA(() =>
      scoped.restaurant.create({
        data: {
          name: 'Spoof Attempt Restaurant',
          slug: `${TEST_PREFIX}spoof-${randomUUID()}`,
          status: 'Active',
          organizationId: orgB.id, // attempted spoof
        },
      }),
    );

    expect(created.organizationId).toBe(orgA.id);
    expect(created.organizationId).not.toBe(orgB.id);
  });

  it('throws TenantContextMissingException when no context is bound', async () => {
    if (!dbAvailable) return;

    await expect(scoped.restaurant.findMany()).rejects.toBeInstanceOf(
      TenantContextMissingException,
    );
    await expect(
      scoped.restaurant.create({
        data: asRestaurantCreateInput({
          name: 'Unscoped',
          slug: `${TEST_PREFIX}unscoped-${randomUUID()}`,
          status: 'Active',
        }),
      }),
    ).rejects.toBeInstanceOf(TenantContextMissingException);
  });

  it('does not scope models outside the tenant-owned allowlist (e.g. Organization itself)', async () => {
    if (!dbAvailable) return;

    // Organization is the tenant root — it has no organizationId column and
    // must never be scoped/blocked by this extension.
    const found = await asOrgA(() => scoped.organization.findUnique({ where: { id: orgB.id } }));
    expect(found?.id).toBe(orgB.id);
  });

  it('keeps concurrent Tenant A / Tenant B requests isolated under real concurrent DB I/O', async () => {
    if (!dbAvailable) return;

    const iterations = 8;
    const calls: Promise<void>[] = [];

    for (let i = 0; i < iterations; i += 1) {
      calls.push(
        asOrgA(async () => {
          const rows = await scoped.restaurant.findMany({
            where: { slug: { startsWith: TEST_PREFIX } },
          });
          expect(rows.map((r) => r.id)).toContain(restaurantA.id);
          expect(rows.map((r) => r.id)).not.toContain(restaurantB.id);
        }),
      );
      calls.push(
        asOrgB(async () => {
          const rows = await scoped.restaurant.findMany({
            where: { slug: { startsWith: TEST_PREFIX } },
          });
          expect(rows.map((r) => r.id)).toContain(restaurantB.id);
          expect(rows.map((r) => r.id)).not.toContain(restaurantA.id);
        }),
      );
    }

    await Promise.all(calls);
  });

  it('preserves tenant scoping inside a transaction issued by the scoped client', async () => {
    if (!dbAvailable) return;

    await asOrgA(() =>
      scoped.$transaction(async (tx) => {
        const rows = await tx.restaurant.findMany({
          where: { slug: { startsWith: TEST_PREFIX } },
        });
        expect(rows.map((r) => r.id)).toContain(restaurantA.id);
        expect(rows.map((r) => r.id)).not.toContain(restaurantB.id);

        const created = await tx.restaurant.create({
          data: asRestaurantCreateInput({
            name: 'Tx-Scoped Restaurant',
            slug: `${TEST_PREFIX}tx-${randomUUID()}`,
            status: 'Active',
          }),
        });
        expect(created.organizationId).toBe(orgA.id);
      }),
    );
  });

  it('rolls back writes made inside a scoped transaction on error, with no partial cross-tenant artifact', async () => {
    if (!dbAvailable) return;

    const slug = `${TEST_PREFIX}rollback-${randomUUID()}`;

    await expect(
      asOrgA(() =>
        scoped.$transaction(async (tx) => {
          await tx.restaurant.create({
            data: asRestaurantCreateInput({ name: 'Should Roll Back', slug, status: 'Active' }),
          });
          throw new Error('forced rollback');
        }),
      ),
    ).rejects.toThrow('forced rollback');

    const row = await rawPrisma.restaurant.findFirst({ where: { slug } });
    expect(row).toBeNull();
  });

  // A second, unrelated model confirms the extension's enforcement is a
  // genuine `$allModels` allowlist mechanism, not logic hardcoded to
  // Restaurant specifically.
  it('scopes OrganizationMember the same way as Restaurant — cross-tenant read blocked', async () => {
    if (!dbAvailable) return;

    const asA = await asOrgA(() => scoped.organizationMember.findMany({}));
    expect(asA.map((m) => m.id)).toContain(memberA.id);
    expect(asA.map((m) => m.id)).not.toContain(memberB.id);

    const foundCrossTenant = await asOrgA(() =>
      scoped.organizationMember.findUnique({ where: { id: memberB.id } }),
    );
    expect(foundCrossTenant).toBeNull();
  });

  it('auto-injects organizationId for OrganizationMember creates too', async () => {
    if (!dbAvailable) return;

    const user = await rawPrisma.user.create({
      data: {
        firstName: 'New',
        lastName: 'Member',
        email: `${TEST_PREFIX}new-member-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });

    const created = await asOrgA(() =>
      scoped.organizationMember.create({
        data: {
          userId: user.id,
          role: 'Staff',
          status: 'Active',
        } as unknown as Prisma.OrganizationMemberUncheckedCreateInput,
      }),
    );

    expect(created.organizationId).toBe(orgA.id);
  });
});
