import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { EMAIL_PROVIDER } from '@shared/application/ports/email-provider.port';
import { RecordingEmailProvider } from '../authentication/support/in-memory-registration.dependencies';

const prisma = new PrismaClient();
const TEST_PREFIX = 'org_inv_e2e_';
const PASSWORD = 'SecurePass123!';
const NEW_USER_PASSWORD = 'BrandNewPassw0rd!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 19.8 — Owner Invite (ADR-036, Option B: explicit acceptance-
 * required invitation lifecycle). Real-HTTP proof of the full lifecycle
 * (issue -> list -> revoke, and issue -> accept for both the existing-User
 * and new-User branches) plus the security scenarios enumerated in the
 * Owner Invite architecture decision's Section 17.
 */
describe('Organizations — Owner Invite (e2e, Phase 19.8)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let passwordHash = 'argon2id$test';
  let emailProvider: RecordingEmailProvider;

  const createdOrganizationIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — Owner Invite e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    emailProvider = new RecordingEmailProvider();
    // TESTING_STRATEGY.md "External Provider Policy" - no real SMTP call
    // from any automated test; the real SmtpEmailProvider binding is
    // replaced with an in-memory fake that records every call.
    app = await createTestApp([], [{ provide: EMAIL_PROVIDER, useValue: emailProvider }]);
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.organizationInvitation.deleteMany({
        where: { organizationId: { in: createdOrganizationIds } },
      });
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
      await prisma.deviceSession.deleteMany({
        where: {
          OR: [
            { userId: { in: createdUserIds } },
            { user: { email: { startsWith: TEST_PREFIX } } },
          ],
        },
      });
      await prisma.tokenFamily.deleteMany({
        where: {
          OR: [
            { userId: { in: createdUserIds } },
            { user: { email: { startsWith: TEST_PREFIX } } },
          ],
        },
      });
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

  async function login(email: string, password: string = PASSWORD): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password, deviceType: 'web' })
      .expect(200);
    return response.body.data.accessToken as string;
  }

  function authed(token: string, method: 'get' | 'post' | 'delete', path: string) {
    return request(app!.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);
  }

  async function issueInvitation(
    ownerToken: string,
    email: string,
    role: 'Admin' | 'Billing' | 'Staff' = 'Staff',
  ) {
    return authed(ownerToken, 'post', '/api/v1/organizations/invitations')
      .send({ email, role })
      .expect(201);
  }

  function rawTokenFromLastEmail(): string {
    const call = emailProvider.calls[emailProvider.calls.length - 1];
    const match = call.html.match(/token=([^"&]+)/);
    if (!match) {
      throw new Error('No invitation token found in the last recorded email.');
    }
    return decodeURIComponent(match[1]);
  }

  describe('POST /organizations/invitations', () => {
    it('rejects unauthenticated requests (401)', async () => {
      if (!dbAvailable || !app) return;
      await request(app.getHttpServer())
        .post('/api/v1/organizations/invitations')
        .send({ email: 'x@example.com', role: 'Staff' })
        .expect(401);
    });

    it('Owner issues an invitation (201) and the invitee is emailed a working accept link; Staff cannot (403)', async () => {
      if (!dbAvailable || !app) return;
      const { organizationId, ownerEmail } = await seedOrganizationWithOwner();
      const staff = await addMember(organizationId, 'Staff');
      const ownerToken = await login(ownerEmail);
      const staffToken = await login(staff.email);

      const invitedEmail = `${TEST_PREFIX}invitee-${uniqueId()}@example.com`;
      const res = await issueInvitation(ownerToken, invitedEmail, 'Admin');
      expect(res.body.data).toMatchObject({
        organizationId,
        email: invitedEmail,
        status: 'pending',
      });
      expect(emailProvider.calls.some((call) => call.to === invitedEmail)).toBe(true);

      await authed(staffToken, 'post', '/api/v1/organizations/invitations')
        .send({ email: `${TEST_PREFIX}x-${uniqueId()}@example.com`, role: 'Staff' })
        .expect(403);
    });

    it('rejects granting Owner by invitation (400)', async () => {
      if (!dbAvailable || !app) return;
      const { ownerEmail } = await seedOrganizationWithOwner();
      const ownerToken = await login(ownerEmail);

      await authed(ownerToken, 'post', '/api/v1/organizations/invitations')
        .send({ email: `${TEST_PREFIX}x-${uniqueId()}@example.com`, role: 'Owner' })
        .expect(400);
    });

    it('rejects inviting an email that already belongs to an Active member (409)', async () => {
      if (!dbAvailable || !app) return;
      const { organizationId, ownerEmail } = await seedOrganizationWithOwner();
      const staff = await addMember(organizationId, 'Staff');
      const ownerToken = await login(ownerEmail);

      await authed(ownerToken, 'post', '/api/v1/organizations/invitations')
        .send({ email: staff.email, role: 'Admin' })
        .expect(409);
    });
  });

  describe('GET /organizations/invitations', () => {
    it('Owner lists invitations (200); Staff cannot (403)', async () => {
      if (!dbAvailable || !app) return;
      const { organizationId, ownerEmail } = await seedOrganizationWithOwner();
      const staff = await addMember(organizationId, 'Staff');
      const ownerToken = await login(ownerEmail);
      const staffToken = await login(staff.email);
      await issueInvitation(ownerToken, `${TEST_PREFIX}list-${uniqueId()}@example.com`);

      const res = await authed(ownerToken, 'get', '/api/v1/organizations/invitations').expect(200);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);

      await authed(staffToken, 'get', '/api/v1/organizations/invitations').expect(403);
    });
  });

  describe('DELETE /organizations/invitations/:invitationId', () => {
    it('Owner revokes a Pending invitation (200); cross-org target is 404; already-revoked is 409', async () => {
      if (!dbAvailable || !app) return;
      const { ownerEmail } = await seedOrganizationWithOwner();
      const ownerToken = await login(ownerEmail);
      const issued = await issueInvitation(
        ownerToken,
        `${TEST_PREFIX}revoke-${uniqueId()}@example.com`,
      );
      const invitationId = issued.body.data.id;

      const res = await authed(
        ownerToken,
        'delete',
        `/api/v1/organizations/invitations/${invitationId}`,
      ).expect(200);
      expect(res.body.data.status).toBe('revoked');

      await authed(
        ownerToken,
        'delete',
        `/api/v1/organizations/invitations/${invitationId}`,
      ).expect(409);

      const { ownerEmail: otherOwnerEmail } = await seedOrganizationWithOwner();
      const otherOwnerToken = await login(otherOwnerEmail);
      const otherIssued = await issueInvitation(
        otherOwnerToken,
        `${TEST_PREFIX}other-${uniqueId()}@example.com`,
      );
      await authed(
        ownerToken,
        'delete',
        `/api/v1/organizations/invitations/${otherIssued.body.data.id}`,
      ).expect(404);
    });
  });

  describe('POST /invitations/:token/accept', () => {
    it('rejects an invalid token (400)', async () => {
      if (!dbAvailable || !app) return;
      await request(app!.getHttpServer())
        .post('/api/v1/invitations/not-a-real-token/accept')
        .send({ firstName: 'A', lastName: 'B', password: NEW_USER_PASSWORD })
        .expect(400);
    });

    it('new-account branch: creates the User and OrganizationMember atomically (200)', async () => {
      if (!dbAvailable || !app) return;
      const { organizationId, ownerEmail } = await seedOrganizationWithOwner();
      const ownerToken = await login(ownerEmail);
      const invitedEmail = `${TEST_PREFIX}newacct-${uniqueId()}@example.com`;
      await issueInvitation(ownerToken, invitedEmail, 'Admin');
      const token = rawTokenFromLastEmail();

      const res = await request(app!.getHttpServer())
        .post(`/api/v1/invitations/${token}/accept`)
        .send({ firstName: 'Jane', lastName: 'Doe', password: NEW_USER_PASSWORD })
        .expect(200);
      expect(res.body.data).toMatchObject({ organizationId, role: 'Admin', accountCreated: true });
      createdUserIds.push(res.body.data.userId);

      const createdUser = await prisma.user.findUnique({ where: { id: res.body.data.userId } });
      expect(createdUser?.email).toBe(invitedEmail);
      expect(createdUser?.emailVerified).toBe(true);

      const member = await prisma.organizationMember.findUnique({
        where: { id: res.body.data.memberId },
      });
      expect(member).toMatchObject({
        organizationId,
        userId: res.body.data.userId,
        role: 'Admin',
        status: 'Active',
      });

      // The invitee can now log in with the password they chose during acceptance.
      await login(invitedEmail, NEW_USER_PASSWORD);
    });

    it('replay: accepting the same token twice fails the second time (400)', async () => {
      if (!dbAvailable || !app) return;
      const { ownerEmail } = await seedOrganizationWithOwner();
      const ownerToken = await login(ownerEmail);
      const invitedEmail = `${TEST_PREFIX}replay-${uniqueId()}@example.com`;
      await issueInvitation(ownerToken, invitedEmail);
      const token = rawTokenFromLastEmail();

      await request(app!.getHttpServer())
        .post(`/api/v1/invitations/${token}/accept`)
        .send({ firstName: 'A', lastName: 'B', password: NEW_USER_PASSWORD })
        .expect(200)
        .then((res) => createdUserIds.push(res.body.data.userId));

      await request(app!.getHttpServer())
        .post(`/api/v1/invitations/${token}/accept`)
        .send({ firstName: 'A', lastName: 'B', password: NEW_USER_PASSWORD })
        .expect(400);
    });

    it('revoked token cannot be accepted (400)', async () => {
      if (!dbAvailable || !app) return;
      const { ownerEmail } = await seedOrganizationWithOwner();
      const ownerToken = await login(ownerEmail);
      const invitedEmail = `${TEST_PREFIX}revoked-${uniqueId()}@example.com`;
      const issued = await issueInvitation(ownerToken, invitedEmail);
      const token = rawTokenFromLastEmail();
      await authed(
        ownerToken,
        'delete',
        `/api/v1/organizations/invitations/${issued.body.data.id}`,
      ).expect(200);

      await request(app!.getHttpServer())
        .post(`/api/v1/invitations/${token}/accept`)
        .send({ firstName: 'A', lastName: 'B', password: NEW_USER_PASSWORD })
        .expect(400);
    });

    it('expired token cannot be accepted (400)', async () => {
      if (!dbAvailable || !app) return;
      const { ownerEmail } = await seedOrganizationWithOwner();
      const ownerToken = await login(ownerEmail);
      const invitedEmail = `${TEST_PREFIX}expired-${uniqueId()}@example.com`;
      const issued = await issueInvitation(ownerToken, invitedEmail);
      const token = rawTokenFromLastEmail();
      await prisma.organizationInvitation.update({
        where: { id: issued.body.data.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await request(app!.getHttpServer())
        .post(`/api/v1/invitations/${token}/accept`)
        .send({ firstName: 'A', lastName: 'B', password: NEW_USER_PASSWORD })
        .expect(400);
    });

    it('existing-account branch: requires login (401), rejects a mismatched authenticated identity (403), succeeds for the correct one (200)', async () => {
      if (!dbAvailable || !app) return;
      const { organizationId, ownerEmail } = await seedOrganizationWithOwner();
      const ownerToken = await login(ownerEmail);
      const existingAccountEmail = `${TEST_PREFIX}existing-${uniqueId()}@example.com`;
      await prisma.user.create({
        data: {
          firstName: 'Already',
          lastName: 'Registered',
          email: existingAccountEmail,
          passwordHash,
          language: 'en',
          status: 'Active',
          emailVerified: true,
        },
      });
      const issued = await issueInvitation(ownerToken, existingAccountEmail, 'Billing');
      const token = rawTokenFromLastEmail();

      // Unauthenticated - must log in first.
      await request(app!.getHttpServer())
        .post(`/api/v1/invitations/${token}/accept`)
        .send({})
        .expect(401);

      // Authenticated as a DIFFERENT user - email mismatch, forbidden.
      const { ownerEmail: otherOwnerEmail } = await seedOrganizationWithOwner();
      const otherOwnerToken = await login(otherOwnerEmail);
      await request(app!.getHttpServer())
        .post(`/api/v1/invitations/${token}/accept`)
        .set('Authorization', `Bearer ${otherOwnerToken}`)
        .send({})
        .expect(403);

      // Authenticated as the correct, invited user - succeeds, no new account.
      const correctToken = await login(existingAccountEmail);
      const res = await request(app!.getHttpServer())
        .post(`/api/v1/invitations/${token}/accept`)
        .set('Authorization', `Bearer ${correctToken}`)
        .send({})
        .expect(200);
      expect(res.body.data).toMatchObject({
        organizationId,
        role: 'Billing',
        accountCreated: false,
      });
      void issued;
    });

    it('rejects acceptance once the Organization has been deleted (409)', async () => {
      if (!dbAvailable || !app) return;
      const { organizationId, ownerEmail } = await seedOrganizationWithOwner();
      const ownerToken = await login(ownerEmail);
      const invitedEmail = `${TEST_PREFIX}deletedorg-${uniqueId()}@example.com`;
      await issueInvitation(ownerToken, invitedEmail);
      const token = rawTokenFromLastEmail();
      await prisma.organization.update({
        where: { id: organizationId },
        data: { deletedAt: new Date() },
      });

      await request(app!.getHttpServer())
        .post(`/api/v1/invitations/${token}/accept`)
        .send({ firstName: 'A', lastName: 'B', password: NEW_USER_PASSWORD })
        .expect(409);
    });

    it('rejects acceptance while the Organization is Suspended (409)', async () => {
      if (!dbAvailable || !app) return;
      const { organizationId, ownerEmail } = await seedOrganizationWithOwner();
      const ownerToken = await login(ownerEmail);
      const invitedEmail = `${TEST_PREFIX}suspendedorg-${uniqueId()}@example.com`;
      await issueInvitation(ownerToken, invitedEmail);
      const token = rawTokenFromLastEmail();
      await prisma.organization.update({
        where: { id: organizationId },
        data: { status: 'Suspended' },
      });

      await request(app!.getHttpServer())
        .post(`/api/v1/invitations/${token}/accept`)
        .send({ firstName: 'A', lastName: 'B', password: NEW_USER_PASSWORD })
        .expect(409);
    });
  });

  it('Swagger document exposes all four Owner Invite routes and never exposes tokenHash', async () => {
    if (!dbAvailable || !app) return;
    const { SwaggerModule, DocumentBuilder } = await import('@nestjs/swagger');
    const document = SwaggerModule.createDocument(
      app as unknown as Parameters<typeof SwaggerModule.createDocument>[0],
      new DocumentBuilder().build(),
    );
    expect(document.paths['/api/v1/organizations/invitations']).toHaveProperty('post');
    expect(document.paths['/api/v1/organizations/invitations']).toHaveProperty('get');
    expect(document.paths['/api/v1/organizations/invitations/{invitationId}']).toHaveProperty(
      'delete',
    );
    expect(document.paths['/api/v1/invitations/{token}/accept']).toHaveProperty('post');
    expect(JSON.stringify(document)).not.toContain('tokenHash');
  });
});
