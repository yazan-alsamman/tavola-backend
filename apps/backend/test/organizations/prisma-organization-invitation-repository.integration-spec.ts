import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaOrganizationInvitationRepository } from '@modules/organizations/infrastructure/persistence/prisma-organization-invitation.repository';
import { OrganizationInvitation } from '@modules/organizations/domain/entities/organization-invitation.entity';
import {
  OrganizationMemberRole,
  OrganizationInvitationStatus,
} from '@modules/organizations/domain/enums/organization.enums';
import { OrganizationId } from '@shared/domain/value-objects/identifiers.vo';
import { DuplicatePendingInvitationException } from '@modules/organizations/domain/exceptions/duplicate-pending-invitation.exception';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * Phase 19.8 (Owner Invite, ADR-036). Proves, against a real PostgreSQL
 * instance, the two properties a unit test (in-memory fake) cannot: (1) the
 * hand-written partial unique index (`organization_invitations_org_email_one_pending_key`)
 * actually rejects a second simultaneously-Pending row for the same
 * (organizationId, email) at the database level, and (2) this repository is
 * genuinely reachable with NO bound `TenantContext` (Pattern 2 - see the
 * repository's own doc comment) - `OrganizationInvitation` is deliberately
 * NOT in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`, unlike
 * `OrganizationMember`.
 */

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'org-invitation-repo-';

describe('PrismaOrganizationInvitationRepository (integration)', () => {
  let dbAvailable = false;
  let repository: PrismaOrganizationInvitationRepository;

  let orgA: { id: string };
  let orgB: { id: string };
  let inviterUserId: string;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaOrganizationInvitationRepository]);
    repository = moduleRef.get(PrismaOrganizationInvitationRepository);

    orgA = await rawPrisma.organization.create({
      data: {
        name: 'Invitation Repo Org A',
        slug: `${TEST_PREFIX}org-a-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}a@example.com`,
      },
    });
    orgB = await rawPrisma.organization.create({
      data: {
        name: 'Invitation Repo Org B',
        slug: `${TEST_PREFIX}org-b-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}b@example.com`,
      },
    });
    const inviter = await rawPrisma.user.create({
      data: {
        firstName: 'Inviter',
        lastName: 'Fixture',
        email: `${TEST_PREFIX}inviter-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    inviterUserId = inviter.id;
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await rawPrisma.organizationInvitation.deleteMany({
      where: { organization: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  function buildInvitation(
    overrides: Partial<Parameters<typeof OrganizationInvitation.create>[0]> = {},
  ) {
    const now = new Date();
    return OrganizationInvitation.create({
      id: randomUUID(),
      organizationId: orgA.id,
      email: `${TEST_PREFIX}invitee-${randomUUID()}@example.com`,
      role: OrganizationMemberRole.Staff,
      tokenHash: `hash-${randomUUID()}`,
      invitedByUserId: inviterUserId,
      status: OrganizationInvitationStatus.Pending,
      expiresAt: new Date(now.getTime() + 3_600_000),
      acceptedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  }

  it('save() works with NO bound TenantContext (Pattern 2 - deliberately not a DIRECT_TENANT_OWNED_MODEL)', async () => {
    if (!dbAvailable) return;
    const invitation = buildInvitation();

    await expect(repository.save(invitation)).resolves.not.toThrow();

    const row = await rawPrisma.organizationInvitation.findUnique({ where: { id: invitation.id } });
    expect(row?.organizationId).toBe(orgA.id);
  });

  it('findByTokenHash resolves the row with no bound TenantContext (mirrors PasswordResetToken)', async () => {
    if (!dbAvailable) return;
    const invitation = buildInvitation();
    await repository.save(invitation);

    const found = await repository.findByTokenHash(invitation.tokenHash);
    expect(found?.toProps().id).toBe(invitation.id);

    expect(await repository.findByTokenHash(`unknown-${randomUUID()}`)).toBeNull();
  });

  it('findById never resolves a row belonging to a different Organization (explicit application-layer scoping)', async () => {
    if (!dbAvailable) return;
    const invitationA = buildInvitation({ organizationId: orgA.id });
    await repository.save(invitationA);

    const foundAsOwnOrg = await repository.findById(invitationA.id, OrganizationId.create(orgA.id));
    expect(foundAsOwnOrg?.toProps().id).toBe(invitationA.id);

    const foundAsOtherOrg = await repository.findById(
      invitationA.id,
      OrganizationId.create(orgB.id),
    );
    expect(foundAsOtherOrg).toBeNull();
  });

  it('listByOrganization only returns the requested Organization’s invitations', async () => {
    if (!dbAvailable) return;
    const invitationA = buildInvitation({ organizationId: orgA.id });
    const invitationB = buildInvitation({ organizationId: orgB.id });
    await repository.save(invitationA);
    await repository.save(invitationB);

    const { items } = await repository.listByOrganization(OrganizationId.create(orgA.id), 1, 100);
    expect(items.map((item) => item.toProps().id)).toContain(invitationA.id);
    expect(items.map((item) => item.toProps().id)).not.toContain(invitationB.id);
  });

  it('the partial unique index rejects a second simultaneously-Pending row for the same (organizationId, email)', async () => {
    if (!dbAvailable) return;
    const email = `${TEST_PREFIX}dup-${randomUUID()}@example.com`;
    await repository.save(buildInvitation({ email }));

    await expect(repository.save(buildInvitation({ email }))).rejects.toBeInstanceOf(
      DuplicatePendingInvitationException,
    );
  });

  it('allows a new Pending row for the same (organizationId, email) once the prior one is no longer Pending', async () => {
    if (!dbAvailable) return;
    const email = `${TEST_PREFIX}resend-${randomUUID()}@example.com`;
    const first = buildInvitation({ email });
    await repository.save(first);
    await repository.revokePendingByOrganizationAndEmail(
      OrganizationId.create(orgA.id),
      email,
      new Date(),
    );

    await expect(repository.save(buildInvitation({ email }))).resolves.not.toThrow();
  });

  it('revokeIfPending is a real CAS: succeeds once, fails the second time (idempotency is not silent)', async () => {
    if (!dbAvailable) return;
    const invitation = buildInvitation();
    await repository.save(invitation);

    const first = await repository.revokeIfPending(
      invitation.id,
      OrganizationId.create(orgA.id),
      new Date(),
    );
    expect(first).toBe(true);

    const second = await repository.revokeIfPending(
      invitation.id,
      OrganizationId.create(orgA.id),
      new Date(),
    );
    expect(second).toBe(false);

    const row = await rawPrisma.organizationInvitation.findUnique({ where: { id: invitation.id } });
    expect(row?.status).toBe('Revoked');
  });

  it('consumeIfPending is a real CAS against concurrent DB writes: exactly one of two simultaneous attempts succeeds', async () => {
    if (!dbAvailable) return;
    const invitation = buildInvitation();
    await repository.save(invitation);
    const now = new Date();

    const [first, second] = await Promise.all([
      repository.consumeIfPending(invitation.id, now),
      repository.consumeIfPending(invitation.id, now),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    const row = await rawPrisma.organizationInvitation.findUnique({ where: { id: invitation.id } });
    expect(row?.status).toBe('Accepted');
  });

  it('consumeIfPending refuses an already-expired row even though it is still status Pending in the database', async () => {
    if (!dbAvailable) return;
    const invitation = buildInvitation({ expiresAt: new Date(Date.now() - 1) });
    await repository.save(invitation);

    const consumed = await repository.consumeIfPending(invitation.id, new Date());
    expect(consumed).toBe(false);

    const row = await rawPrisma.organizationInvitation.findUnique({ where: { id: invitation.id } });
    expect(row?.status).toBe('Pending'); // never persisted as "Expired" - see the model's own schema comment
  });

  it('the token_hash column is unique at the database level', async () => {
    if (!dbAvailable) return;
    const sharedHash = `hash-${randomUUID()}`;
    await repository.save(buildInvitation({ tokenHash: sharedHash }));

    await expect(
      rawPrisma.organizationInvitation.create({
        data: {
          organizationId: orgA.id,
          email: `${TEST_PREFIX}unique-token-${randomUUID()}@example.com`,
          role: 'Staff',
          tokenHash: sharedHash,
          invitedByUserId: inviterUserId,
          status: 'Pending',
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });
});
