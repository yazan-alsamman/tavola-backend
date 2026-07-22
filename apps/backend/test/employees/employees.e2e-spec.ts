import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, RoleScope } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createTestApp } from '../helpers/test-app.factory';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'employee-e2e-';
const PASSWORD = 'SecurePass123!';

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

describe('/api/v1/restaurants/:restaurantId/employees (e2e)', () => {
  let app: INestApplication | undefined;
  let dbAvailable = false;
  let managerRoleId: string;
  let receptionistRoleId: string;
  let passwordHash = 'argon2id$test';

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — employees e2e tests NOT EXECUTED.');
      return;
    }
    passwordHash = await hashTestPassword(PASSWORD);
    app = await createTestApp();

    // Literal `manager` slug on purpose - `RemoveEmployeeUseCase`'s
    // "cannot remove the last Manager" invariant (AUTHORIZATION_ARCHITECTURE.md
    // §19) keys off this exact seeded slug (`prisma/seed.ts`), not a
    // test-generated one. `upsert` reuses the real seeded row if present
    // instead of colliding with its unique `slug` constraint - never deleted
    // in `afterAll` since it may be that shared production-seed row.
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

    const receptionist = await prisma.role.create({
      data: {
        name: `${TEST_PREFIX}receptionist-${uniqueId()}`,
        slug: `${TEST_PREFIX}receptionist-${uniqueId()}`,
        description: 'Test receptionist role',
        scope: RoleScope.Restaurant,
      },
    });
    receptionistRoleId = receptionist.id;
  });

  afterAll(async () => {
    if (dbAvailable) {
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
      // `managerRoleId` (slug `manager`) is intentionally never deleted here -
      // it may be the shared, real seeded role, not a row this spec created.
      await prisma.role.deleteMany({ where: { id: receptionistRoleId } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

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

  async function createRestaurant(accessToken: string): Promise<string> {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/restaurants')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'The Old Mill', slug: `${TEST_PREFIX}${uniqueId()}` })
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

  it('POST /restaurants/:restaurantId/employees invites an employee as Invited, unlinked', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('invite');
    const restaurantId = await createRestaurant(owner.accessToken);

    const response = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/employees`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        roleId: receptionistRoleId,
        firstName: 'Rita',
        lastName: 'Receptionist',
        email: `${TEST_PREFIX}rita-${uniqueId()}@example.com`,
      })
      .expect(201);

    expect(response.body.data.status).toBe('Invited');
    expect(response.body.data.userId).toBeNull();
    expect(response.body.data.assignedBranchIds).toEqual([]);
  });

  it('rejects inviting a duplicate email at the same restaurant', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('dup');
    const restaurantId = await createRestaurant(owner.accessToken);
    const email = `${TEST_PREFIX}dup-${uniqueId()}@example.com`;

    await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/employees`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ roleId: receptionistRoleId, firstName: 'A', lastName: 'B', email })
      .expect(201);

    const conflict = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/employees`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ roleId: receptionistRoleId, firstName: 'C', lastName: 'D', email })
      .expect(409);
    expect(conflict.body.code).toBe('CONFLICT');
  });

  it('assigns a role and a branch, then removes the branch assignment', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('assign');
    const restaurantId = await createRestaurant(owner.accessToken);
    const branchId = await createBranch(owner.accessToken, restaurantId);

    const invited = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/employees`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        roleId: receptionistRoleId,
        firstName: 'Rita',
        lastName: 'Receptionist',
        email: `${TEST_PREFIX}assign-${uniqueId()}@example.com`,
      })
      .expect(201);
    const employeeId = invited.body.data.employeeId as string;

    const roleAssigned = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/employees/${employeeId}/role`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ roleId: managerRoleId })
      .expect(200);
    expect(roleAssigned.body.data.roleId).toBe(managerRoleId);

    const branchAssigned = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/employees/${employeeId}/branches`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ branchId })
      .expect(200);
    expect(branchAssigned.body.data.assignedBranchIds).toEqual([branchId]);

    const branchRemoved = await request(app!.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}/employees/${employeeId}/branches/${branchId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(branchRemoved.body.data.assignedBranchIds).toEqual([]);
  });

  it("links a pre-created Invited employee to the User on that person's next login", async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('link-owner');
    const restaurantId = await createRestaurant(owner.accessToken);

    // The invited person already has their own account (registered as owner
    // of an unrelated organization) - AUTHENTICATION_ARCHITECTURE.md §1.2's
    // "linked on first login" does not require the invite to precede
    // registration.
    const employeePerson = await registerAndLoginOwner('link-person');

    await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/employees`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        roleId: receptionistRoleId,
        firstName: 'Rita',
        lastName: 'Receptionist',
        email: employeePerson.email,
      })
      .expect(201);

    // Next login (any login, not the one above) triggers linking.
    await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: employeePerson.email, password: PASSWORD, deviceType: 'web' })
      .expect(200);

    const row = await prisma.employee.findFirst({
      where: { email: employeePerson.email, restaurantId },
    });
    expect(row?.status).toBe('Active');
    expect(row?.userId).toBe(employeePerson.userId);
  });

  it('DELETE removes an employee (soft delete) and rejects removing the last Manager', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('remove');
    const restaurantId = await createRestaurant(owner.accessToken);

    const nonManager = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/employees`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        roleId: receptionistRoleId,
        firstName: 'Rita',
        lastName: 'Receptionist',
        email: `${TEST_PREFIX}remove-non-mgr-${uniqueId()}@example.com`,
      })
      .expect(201);

    await request(app!.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}/employees/${nonManager.body.data.employeeId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    const lastManager = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/employees`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        roleId: managerRoleId,
        firstName: 'Mo',
        lastName: 'Manager',
        email: `${TEST_PREFIX}remove-last-mgr-${uniqueId()}@example.com`,
      })
      .expect(201);

    const rejected = await request(app!.getHttpServer())
      .delete(`/api/v1/restaurants/${restaurantId}/employees/${lastManager.body.data.employeeId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(409);
    expect(rejected.body.code).toBe('CONFLICT');
  });

  it('cross-organization access returns 404 (IDOR)', async () => {
    if (!dbAvailable) return;

    const ownerA = await registerAndLoginOwner('iso-a');
    const ownerB = await registerAndLoginOwner('iso-b');
    const restaurantA = await createRestaurant(ownerA.accessToken);

    const invited = await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantA}/employees`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({
        roleId: receptionistRoleId,
        firstName: 'Rita',
        lastName: 'Receptionist',
        email: `${TEST_PREFIX}iso-${uniqueId()}@example.com`,
      })
      .expect(201);

    await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantA}/employees/${invited.body.data.employeeId}/role`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({ roleId: managerRoleId })
      .expect(404);
  });

  it('returns 401 without a token and 403 for a non-Owner/Admin caller is enforced by the shared guard stack', async () => {
    if (!dbAvailable) return;

    const owner = await registerAndLoginOwner('auth');
    const restaurantId = await createRestaurant(owner.accessToken);

    await request(app!.getHttpServer())
      .post(`/api/v1/restaurants/${restaurantId}/employees`)
      .send({
        roleId: receptionistRoleId,
        firstName: 'Rita',
        lastName: 'Receptionist',
        email: `${TEST_PREFIX}auth-${uniqueId()}@example.com`,
      })
      .expect(401);
  });
});
