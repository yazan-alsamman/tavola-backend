import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, RoleScope } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'messaging-e2e-';
const PASSWORD = 'SecurePass123!';
const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

// Small, fast-testable override for THIS file's own isolated app instance
// only - see test/authentication/rate-limit.e2e-spec.ts's own precedent for
// why this is scoped to this file (restored in afterAll).
const RATE_LIMIT_OVERRIDE = { max: '3', window: '60' };
const RATE_LIMIT_RESTORE = { max: '1000', window: '60' };

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

/**
 * Phase 15.6 (Messaging, ADR-020 corrected by ADR-030) e2e coverage: the
 * full `/conversations` and `/restaurants/:restaurantId/conversations`
 * surface, real Postgres + real HTTP, mirroring
 * `test/tables/merge-split.e2e-spec.ts`'s own fixture style.
 */
describe('Messaging (Phase 15.6) (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let managerRoleId: string;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — messaging e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);

    process.env.RATE_LIMIT_MESSAGING_SEND_MAX = RATE_LIMIT_OVERRIDE.max;
    process.env.RATE_LIMIT_MESSAGING_SEND_WINDOW_SECONDS = RATE_LIMIT_OVERRIDE.window;

    app = await createTestApp();

    // Real seeded slug (prisma/seed.ts): `manager` already carries
    // `conversations:manage` via a RolePermission row, exactly like
    // `test/tables/merge-split.e2e-spec.ts` trusts `tables:manage` is
    // already seeded - no manual RolePermission wiring needed here.
    const manager = await prisma.role.upsert({
      where: { slug: 'manager' },
      update: {},
      create: {
        name: 'Restaurant Manager',
        slug: 'manager',
        description: 'Full restaurant operational access within assigned scope',
        scope: RoleScope.Restaurant,
      },
    });
    managerRoleId = manager.id;
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.notification.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.message.deleteMany({
        where: { conversation: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
      });
      await prisma.conversationParticipant.deleteMany({
        where: { conversation: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
      });
      await prisma.conversation.deleteMany({
        where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
      });
      await prisma.employeeBranchAssignment.deleteMany({
        where: { employee: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
      });
      await prisma.employee.deleteMany({
        where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
      });
      await prisma.branch.deleteMany({
        where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
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

      process.env.RATE_LIMIT_MESSAGING_SEND_MAX = RATE_LIMIT_RESTORE.max;
      process.env.RATE_LIMIT_MESSAGING_SEND_WINDOW_SECONDS = RATE_LIMIT_RESTORE.window;
    }
    if (app) {
      await app.close();
    }
  });

  // -----------------------------------------------------------------------
  // Fixture helpers (mirrors test/tables/merge-split.e2e-spec.ts)
  // -----------------------------------------------------------------------

  async function registerAndLoginOwner(
    suffix: string,
  ): Promise<{ accessToken: string; organizationId: string; userId: string; email: string }> {
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
      email,
    };
  }

  async function registerAndLoginCustomer(
    suffix: string,
  ): Promise<{ accessToken: string; userId: string; email: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Test',
        lastName: suffix,
        email,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    return { accessToken: loginResponse.body.data.accessToken as string, userId, email };
  }

  async function createRestaurant(accessToken: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'The Chat Bistro', slug: `${TEST_PREFIX}${uniqueId()}` })
      .expect(201);
    return response.body.data.restaurantId as string;
  }

  async function createBranch(accessToken: string, restaurantId: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/branches`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        city: 'Damascus',
        address: '123 Main St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      })
      .expect(201);
    return response.body.data.branchId as string;
  }

  async function inviteAndLoginEmployee(
    ownerAccessToken: string,
    restaurantId: string,
    roleId: string,
    branchIds?: string[],
  ): Promise<{ accessToken: string; employeeId: string }> {
    const person = await registerAndLoginOwner(`emp-${uniqueId()}`);
    const invited = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/employees`)
      .set('Authorization', `Bearer ${ownerAccessToken}`)
      .send({ roleId, firstName: 'Emma', lastName: 'Ployee', email: person.email })
      .expect(201);
    const employeeId = invited.body.data.employeeId as string;

    for (const branchId of branchIds ?? []) {
      await request(app!.getHttpServer())
        .post(`/api/v1/restaurants/${restaurantId}/employees/${employeeId}/branches`)
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({ branchId })
        .expect(200);
    }

    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: person.email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    return { accessToken: loginResponse.body.data.accessToken as string, employeeId };
  }

  async function setUpWorld(suffix: string) {
    const owner = await registerAndLoginOwner(suffix);
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);
    const employee = await inviteAndLoginEmployee(owner.accessToken, restaurantId, managerRoleId, [
      branchId,
    ]);
    const customer = await registerAndLoginCustomer(suffix);
    return { owner, restaurantId, branchId, employee, customer };
  }

  // -----------------------------------------------------------------------
  // Golden path: start -> send (both sides) -> list -> notification -> read
  // -----------------------------------------------------------------------

  it('Customer starts a conversation, both sides exchange messages, staff reply notifies the customer, and read receipts update per-person', async () => {
    if (!dbAvailable || !app) return;
    const { restaurantId, branchId, employee, customer } = await setUpWorld('golden');

    const startResponse = await request(app.getHttpServer())
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ restaurantId, branchId, subject: 'Table for 4 tonight' })
      .expect(201);
    const conversationId = startResponse.body.data.conversationId as string;
    expect(startResponse.body.data.status).toBe('Open');

    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ body: 'Is my table still available at 8pm?' })
      .expect(201);

    const staffListResponse = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/conversations`)
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(200);
    expect(
      staffListResponse.body.data.items.some(
        (c: { conversationId: string }) => c.conversationId === conversationId,
      ),
    ).toBe(true);

    const replyResponse = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .send({ body: 'Yes, table for 4 is confirmed for 8pm!' })
      .expect(201);
    expect(replyResponse.body.data.senderType).toBe('Employee');
    expect(replyResponse.body.data.senderEmployeeId).toBe(employee.employeeId);

    // D6: staff reply notifies the Customer (never the reverse, never staff).
    const notification = await prisma.notification.findFirst({
      where: { userId: customer.userId, type: 'MessageSent' },
    });
    expect(notification).not.toBeNull();
    expect(notification?.data).toMatchObject({ conversationId });

    const messagesResponse = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(messagesResponse.body.data.items).toHaveLength(2);
    expect(messagesResponse.body.data.items[0].body).toBe('Yes, table for 4 is confirmed for 8pm!');

    const readResponse = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(readResponse.body.data.lastReadAt).toBeTruthy();

    const participant = await prisma.conversationParticipant.findFirst({
      where: { conversationId, userId: customer.userId },
    });
    expect(participant?.lastReadAt).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // Close (staff) / Archive (customer) / auto-reopen
  // -----------------------------------------------------------------------

  it('a Restaurant-side actor closes a conversation for both sides, and a new message auto-reopens it (D5)', async () => {
    if (!dbAvailable || !app) return;
    const { restaurantId, employee, customer } = await setUpWorld('close');

    const started = await request(app.getHttpServer())
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ restaurantId })
      .expect(201);
    const conversationId = started.body.data.conversationId as string;

    const closed = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conversationId}/close`)
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(200);
    expect(closed.body.data.status).toBe('Closed');

    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ body: 'Are you still there?' })
      .expect(201);

    const reopened = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(reopened.body.data.status).toBe('Open');
  });

  it('the Customer archives a conversation for themselves only - excluded by default, visible with includeArchived, staff unaffected (D5/D11)', async () => {
    if (!dbAvailable || !app) return;
    const { restaurantId, employee, customer } = await setUpWorld('archive');

    const started = await request(app.getHttpServer())
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ restaurantId })
      .expect(201);
    const conversationId = started.body.data.conversationId as string;

    const archived = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conversationId}/close`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(archived.body.data.status).toBe('Archived');

    const defaultList = await request(app.getHttpServer())
      .get('/api/v1/conversations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(
      defaultList.body.data.items.some(
        (c: { conversationId: string }) => c.conversationId === conversationId,
      ),
    ).toBe(false);

    const includeArchivedList = await request(app.getHttpServer())
      .get('/api/v1/conversations?includeArchived=true')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(
      includeArchivedList.body.data.items.some(
        (c: { conversationId: string }) => c.conversationId === conversationId,
      ),
    ).toBe(true);

    const staffList = await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/conversations`)
      .set('Authorization', `Bearer ${employee.accessToken}`)
      .expect(200);
    expect(
      staffList.body.data.items.some(
        (c: { conversationId: string }) => c.conversationId === conversationId,
      ),
    ).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Cross-tenant / cross-branch denial (D14)
  // -----------------------------------------------------------------------

  it('denies an Employee/OrganizationMember from a different organization (404, IDOR-safe)', async () => {
    if (!dbAvailable || !app) return;
    const { restaurantId, customer } = await setUpWorld('xtenant-a');
    const otherOrg = await setUpWorld('xtenant-b');

    const started = await request(app.getHttpServer())
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ restaurantId })
      .expect(201);
    const conversationId = started.body.data.conversationId as string;

    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${otherOrg.employee.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/restaurants/${restaurantId}/conversations`)
      .set('Authorization', `Bearer ${otherOrg.owner.accessToken}`)
      .expect(404);
  });

  it('denies an Employee assigned only to a different branch (403, EMPLOYEE_BRANCH_NOT_ASSIGNED)', async () => {
    if (!dbAvailable || !app) return;
    const { owner, restaurantId, branchId, customer } = await setUpWorld('xbranch');
    const otherBranchId = await createBranch(owner.accessToken, restaurantId);
    const otherBranchEmployee = await inviteAndLoginEmployee(
      owner.accessToken,
      restaurantId,
      managerRoleId,
      [otherBranchId],
    );

    const started = await request(app.getHttpServer())
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ restaurantId, branchId })
      .expect(201);
    const conversationId = started.body.data.conversationId as string;

    const response = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${otherBranchEmployee.accessToken}`)
      .expect(403);
    expect(response.body.code).toBe('EMPLOYEE_BRANCH_NOT_ASSIGNED');
  });

  // -----------------------------------------------------------------------
  // Idempotency (D12) and rate limiting (D8)
  // -----------------------------------------------------------------------

  it('replays the cached response for a repeated Idempotency-Key instead of creating a second message (D12)', async () => {
    if (!dbAvailable || !app) return;
    const { restaurantId, customer } = await setUpWorld('idempotency');

    const started = await request(app.getHttpServer())
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ restaurantId })
      .expect(201);
    const conversationId = started.body.data.conversationId as string;
    const idempotencyKey = randomUUID();

    const first = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ body: 'Idempotent send' })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ body: 'Idempotent send' })
      .expect(201);

    expect(second.body.data.messageId).toBe(first.body.data.messageId);

    const count = await prisma.message.count({
      where: { conversationId, body: 'Idempotent send' },
    });
    expect(count).toBe(1);
  });

  it('rate-limits SendMessage per participant beyond the configured max (D8, 429)', async () => {
    if (!dbAvailable || !app) return;
    const { restaurantId, customer } = await setUpWorld('ratelimit');

    const started = await request(app.getHttpServer())
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ restaurantId })
      .expect(201);
    const conversationId = started.body.data.conversationId as string;

    const limit = Number(RATE_LIMIT_OVERRIDE.max);
    for (let i = 0; i < limit; i += 1) {
      await request(app.getHttpServer())
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ body: `message ${i}` })
        .expect(201);
    }

    const response = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ body: 'one too many' })
      .expect(429);
    expect(response.body.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  // -----------------------------------------------------------------------
  // Attachments (D7)
  // -----------------------------------------------------------------------

  it('accepts a valid multipart image attachment and links it to the created message (D7)', async () => {
    if (!dbAvailable || !app) return;
    const { restaurantId, customer } = await setUpWorld('attachment');

    const started = await request(app.getHttpServer())
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ restaurantId })
      .expect(201);
    const conversationId = started.body.data.conversationId as string;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .field('body', 'Here is a photo of the issue')
      .attach('file', validJpegBuffer, 'photo.jpg')
      .expect(201);

    expect(response.body.data.attachmentFileId).toBeTruthy();
    const fileRecord = await prisma.file.findUnique({
      where: { id: response.body.data.attachmentFileId },
    });
    expect(fileRecord?.ownerType).toBe('Message');
    expect(fileRecord?.accessPolicy).toBe('Private');
  });

  it('rejects an attachment with an unsupported content type (415)', async () => {
    if (!dbAvailable || !app) return;
    const { restaurantId, customer } = await setUpWorld('attachment-bad');

    const started = await request(app.getHttpServer())
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({ restaurantId })
      .expect(201);
    const conversationId = started.body.data.conversationId as string;

    const response = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .field('body', 'A document, not an image')
      .attach('file', Buffer.from('%PDF-1.4 fake pdf'), {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      })
      .expect(415);
    expect(response.body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });
});
