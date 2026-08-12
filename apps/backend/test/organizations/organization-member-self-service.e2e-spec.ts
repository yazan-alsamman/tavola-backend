import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'org_mem_e2e_';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 19.7 — Organization self-service member management (ADR-034 §7,
 * previously deferred, explicitly authorized this session): Change Role,
 * Remove, Transfer Ownership, and the supporting List read. Real-HTTP proof
 * of authorization boundaries, the single-Owner invariant, and cross-
 * Organization IDOR protection. Owner Invite (Phase 19.8, ADR-036) is a
 * separate capability with its own dedicated suite -
 * test/organizations/organization-invitations.e2e-spec.ts.
 */
describe('Organizations — self-service member management (e2e, Phase 19.7)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';

  const createdOrganizationIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — self-service member e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: createdOrganizationIds } },
      });
      await prisma.subscriptionUsage.deleteMany({
        where: { organizationId: { in: createdOrganizationIds } },
      });
      await prisma.subscription.deleteMany({
        where: { organizationId: { in: createdOrganizationIds } },
      });
      await prisma.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
      await prisma.deviceSession.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.tokenFamily.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({
        where: { OR: [{ email: { startsWith: TEST_PREFIX } }, { id: { in: createdUserIds } }] },
      });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function seedOrganizationWithOwner(): Promise<{
    organizationId: string;
    ownerUserId: string;
    ownerEmail: string;
  }> {
    const ownerEmail = `${TEST_PREFIX}owner-${uniqueId()}@example.com`;
    const { userId, organizationId } = await seedOwnerAndOrganization(prisma, {
      email: ownerEmail,
      passwordHash,
      organizationName: `${TEST_PREFIX}Org ${uniqueId()}`,
    });
    createdOrganizationIds.push(organizationId);
    createdUserIds.push(userId);
    return { organizationId, ownerUserId: userId, ownerEmail };
  }

  async function addMember(
    organizationId: string,
    role: 'Owner' | 'Admin' | 'Billing' | 'Staff',
  ): Promise<{ memberId: string; userId: string; email: string }> {
    const email = `${TEST_PREFIX}member-${uniqueId()}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Member',
        lastName: role,
        email,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    createdUserIds.push(userId);
    const now = new Date();
    const member = await prisma.organizationMember.create({
      data: { organizationId, userId, role, status: 'Active', invitedAt: now, joinedAt: now },
    });
    return { memberId: member.id, userId, email };
  }

  async function login(email: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    return response.body.data.accessToken as string;
  }

  function authed(token: string, method: 'get' | 'patch' | 'delete' | 'post', path: string) {
    return request(app!.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);
  }

  describe('GET /organizations/members', () => {
    it('rejects unauthenticated requests; Owner/Admin can list, Staff cannot', async () => {
      if (!dbAvailable || !app) return;
      await request(app.getHttpServer()).get('/api/v1/organizations/members').expect(401);

      const { organizationId, ownerEmail } = await seedOrganizationWithOwner();
      const staff = await addMember(organizationId, 'Staff');
      const ownerToken = await login(ownerEmail);
      const staffToken = await login(staff.email);

      const res = await authed(ownerToken, 'get', '/api/v1/organizations/members').expect(200);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(2);

      await authed(staffToken, 'get', '/api/v1/organizations/members').expect(403);
    });
  });

  describe('PATCH /organizations/members/:memberId/role', () => {
    it('Owner changes a member role (200); rejects promoting to Owner (403); cross-org target is 404', async () => {
      if (!dbAvailable || !app) return;
      const { organizationId, ownerEmail } = await seedOrganizationWithOwner();
      const staff = await addMember(organizationId, 'Staff');
      const ownerToken = await login(ownerEmail);

      const res = await authed(
        ownerToken,
        'patch',
        `/api/v1/organizations/members/${staff.memberId}/role`,
      )
        .send({ role: 'Admin' })
        .expect(200);
      expect(res.body.data.role).toBe('Admin');

      await authed(ownerToken, 'patch', `/api/v1/organizations/members/${staff.memberId}/role`)
        .send({ role: 'Owner' })
        .expect(403);

      const { organizationId: otherOrgId } = await seedOrganizationWithOwner();
      const otherOrgMember = await addMember(otherOrgId, 'Staff');
      await authed(
        ownerToken,
        'patch',
        `/api/v1/organizations/members/${otherOrgMember.memberId}/role`,
      )
        .send({ role: 'Admin' })
        .expect(404);
    });

    it('rejects a non-Owner/Admin actor (403)', async () => {
      if (!dbAvailable || !app) return;
      const { organizationId } = await seedOrganizationWithOwner();
      const staff = await addMember(organizationId, 'Staff');
      const otherStaff = await addMember(organizationId, 'Staff');
      const staffToken = await login(staff.email);

      await authed(staffToken, 'patch', `/api/v1/organizations/members/${otherStaff.memberId}/role`)
        .send({ role: 'Admin' })
        .expect(403);
    });
  });

  describe('DELETE /organizations/members/:memberId', () => {
    it('Owner removes a member (200); rejects removing the sole Owner (403); cross-org target is 404', async () => {
      if (!dbAvailable || !app) return;
      const { organizationId, ownerUserId, ownerEmail } = await seedOrganizationWithOwner();
      const staff = await addMember(organizationId, 'Staff');
      const ownerToken = await login(ownerEmail);

      const res = await authed(
        ownerToken,
        'delete',
        `/api/v1/organizations/members/${staff.memberId}`,
      ).expect(200);
      expect(res.body.data.status).toBe('Removed');

      const ownerMember = await prisma.organizationMember.findFirst({
        where: { organizationId, userId: ownerUserId },
      });
      await authed(ownerToken, 'delete', `/api/v1/organizations/members/${ownerMember!.id}`).expect(
        403,
      );

      const { organizationId: otherOrgId } = await seedOrganizationWithOwner();
      const otherOrgMember = await addMember(otherOrgId, 'Staff');
      await authed(
        ownerToken,
        'delete',
        `/api/v1/organizations/members/${otherOrgMember.memberId}`,
      ).expect(404);
    });
  });

  describe('POST /organizations/members/:memberId/transfer-ownership', () => {
    it('Owner transfers ownership to an Active member (200): previous owner demoted, new owner promoted', async () => {
      if (!dbAvailable || !app) return;
      const { organizationId, ownerUserId, ownerEmail } = await seedOrganizationWithOwner();
      const admin = await addMember(organizationId, 'Admin');
      const ownerToken = await login(ownerEmail);

      const res = await authed(
        ownerToken,
        'post',
        `/api/v1/organizations/members/${admin.memberId}/transfer-ownership`,
      ).expect(200);
      expect(res.body.data).toMatchObject({
        organizationId,
        previousOwnerUserId: ownerUserId,
        newOwnerUserId: admin.userId,
      });

      const newOwnerRow = await prisma.organizationMember.findUnique({
        where: { id: admin.memberId },
      });
      expect(newOwnerRow?.role).toBe('Owner');
      const previousOwnerRow = await prisma.organizationMember.findFirst({
        where: { organizationId, userId: ownerUserId },
      });
      expect(previousOwnerRow?.role).toBe('Admin');
    });

    it('rejects a non-Owner actor (403); rejects a target from another Organization (404)', async () => {
      if (!dbAvailable || !app) return;
      const { organizationId } = await seedOrganizationWithOwner();
      const admin = await addMember(organizationId, 'Admin');
      const adminToken = await login(admin.email);

      await authed(
        adminToken,
        'post',
        `/api/v1/organizations/members/${admin.memberId}/transfer-ownership`,
      ).expect(403);

      const { organizationId: otherOrgId, ownerEmail: otherOwnerEmail } =
        await seedOrganizationWithOwner();
      const otherOrgMember = await addMember(otherOrgId, 'Admin');
      const otherOwnerToken = await login(otherOwnerEmail);
      // Target belongs to organizationId, not otherOrgId - the caller
      // (Owner of otherOrgId) can never transfer THEIR org's ownership to a
      // member of a different Organization (IDOR-safe by construction, the
      // Prisma tenant-scoping extension never finds the cross-org row).
      const foreignTarget = await addMember(organizationId, 'Admin');
      void otherOrgMember;
      await authed(
        otherOwnerToken,
        'post',
        `/api/v1/organizations/members/${foreignTarget.memberId}/transfer-ownership`,
      ).expect(404);
    });
  });

  it('Swagger document exposes all four self-service member routes', async () => {
    if (!dbAvailable || !app) return;
    const { SwaggerModule, DocumentBuilder } = await import('@nestjs/swagger');
    const document = SwaggerModule.createDocument(
      app as unknown as Parameters<typeof SwaggerModule.createDocument>[0],
      new DocumentBuilder().build(),
    );
    expect(document.paths['/api/v1/organizations/members']).toHaveProperty('get');
    expect(document.paths['/api/v1/organizations/members/{memberId}/role']).toHaveProperty('patch');
    expect(document.paths['/api/v1/organizations/members/{memberId}']).toHaveProperty('delete');
    expect(
      document.paths['/api/v1/organizations/members/{memberId}/transfer-ownership'],
    ).toHaveProperty('post');
  });
});
