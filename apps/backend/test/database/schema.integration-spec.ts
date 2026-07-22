import {
  OrganizationMemberRole,
  OrganizationMemberStatus,
  OrganizationStatus,
  PrismaClient,
  RolePermissionType,
  RoleScope,
  UserStatus,
} from '@prisma/client';

import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';

const prisma = new PrismaClient();

const TEST_PREFIX = 'phase21-test-';

async function cleanupTestData(): Promise<void> {
  await prisma.rolePermission.deleteMany({
    where: {
      OR: [
        { employee: { email: { startsWith: TEST_PREFIX } } },
        { role: { slug: { startsWith: TEST_PREFIX } } },
      ],
    },
  });
  await prisma.employeeBranchAssignment.deleteMany({
    where: { employee: { email: { startsWith: TEST_PREFIX } } },
  });
  await prisma.employee.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.deviceSession.deleteMany({
    where: { user: { email: { startsWith: TEST_PREFIX } } },
  });
  await prisma.tokenFamily.deleteMany({
    where: { user: { email: { startsWith: TEST_PREFIX } } },
  });
  await prisma.organizationMember.deleteMany({
    where: { user: { email: { startsWith: TEST_PREFIX } } },
  });
  await prisma.restaurant.deleteMany({
    where: { slug: { startsWith: TEST_PREFIX } },
  });
  await prisma.organization.deleteMany({
    where: { slug: { startsWith: TEST_PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_PREFIX } },
  });
  await prisma.role.deleteMany({
    where: { slug: { startsWith: TEST_PREFIX } },
  });
  await prisma.permission.deleteMany({
    where: { slug: { startsWith: TEST_PREFIX } },
  });
}

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      firstName: 'Test',
      lastName: 'User',
      email: `${TEST_PREFIX}${suffix}@example.com`,
      passwordHash: 'argon2id$test',
      language: 'en',
      status: UserStatus.Active,
      emailVerified: true,
    },
  });
}

async function createTestOrganization(suffix: string, ownerUserId: string) {
  const organization = await prisma.organization.create({
    data: {
      name: `Test Org ${suffix}`,
      slug: `${TEST_PREFIX}org-${suffix}`,
      billingEmail: `${TEST_PREFIX}billing-${suffix}@example.com`,
      status: OrganizationStatus.Active,
    },
  });

  await prisma.organizationMember.create({
    data: {
      organizationId: organization.id,
      userId: ownerUserId,
      role: OrganizationMemberRole.Owner,
      status: OrganizationMemberStatus.Active,
      joinedAt: new Date(),
    },
  });

  return organization;
}

describe('Phase 2.1 database foundation (integration)', () => {
  let databaseAvailable = false;

  beforeAll(async () => {
    databaseAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(databaseAvailable)) {
      console.warn(
        'PostgreSQL not reachable — skipping database integration tests. Start Docker stack per ENVIRONMENT_SETUP.md.',
      );
    }
  });

  afterAll(async () => {
    if (databaseAvailable) {
      await cleanupTestData();
    }
    await prisma.$disconnect();
  });

  afterEach(async () => {
    if (databaseAvailable) {
      await cleanupTestData();
    }
  });

  const itIfDb = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (!databaseAvailable) {
        return;
      }
      await fn();
    });
  };

  itIfDb('exposes all Phase 2.1 models via Prisma client', async () => {
    const models = [
      'organization',
      'organizationMember',
      'user',
      'tokenFamily',
      'deviceSession',
      'passwordResetToken',
      'passwordHistory',
      'loginAttempt',
      'platformAdmin',
      'restaurant',
      'branch',
      'role',
      'permission',
      'rolePermission',
      'employee',
      'employeeBranchAssignment',
      'userConsent',
      'systemConfiguration',
    ] as const;

    for (const model of models) {
      expect(typeof (prisma as unknown as Record<string, unknown>)[model]).toBe('object');
      await (prisma[model] as { count: () => Promise<number> }).count();
    }
  });

  itIfDb('enforces unique user email', async () => {
    const email = `${TEST_PREFIX}unique-email@example.com`;
    await prisma.user.create({
      data: {
        firstName: 'First',
        lastName: 'User',
        email,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });

    await expect(
      prisma.user.create({
        data: {
          firstName: 'Second',
          lastName: 'User',
          email,
          passwordHash: 'argon2id$test',
          language: 'en',
          status: UserStatus.Pending,
          emailVerified: false,
        },
      }),
    ).rejects.toThrow();
  });

  itIfDb('enforces unique organization member per user', async () => {
    const user = await createTestUser('member-unique');
    const organization = await prisma.organization.create({
      data: {
        name: 'Unique Member Org',
        slug: `${TEST_PREFIX}member-unique-org`,
        billingEmail: `${TEST_PREFIX}member-unique-billing@example.com`,
        status: OrganizationStatus.Active,
      },
    });

    await prisma.organizationMember.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: OrganizationMemberRole.Staff,
        status: OrganizationMemberStatus.Active,
        joinedAt: new Date(),
      },
    });

    await expect(
      prisma.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: OrganizationMemberRole.Admin,
          status: OrganizationMemberStatus.Active,
        },
      }),
    ).rejects.toThrow();
  });

  itIfDb('enforces partial unique one active Owner per organization', async () => {
    const ownerA = await createTestUser('owner-a');
    const ownerB = await createTestUser('owner-b');
    const organization = await prisma.organization.create({
      data: {
        name: 'Single Owner Org',
        slug: `${TEST_PREFIX}single-owner-org`,
        billingEmail: `${TEST_PREFIX}single-owner-billing@example.com`,
        status: OrganizationStatus.Active,
      },
    });

    await prisma.organizationMember.create({
      data: {
        organizationId: organization.id,
        userId: ownerA.id,
        role: OrganizationMemberRole.Owner,
        status: OrganizationMemberStatus.Active,
        joinedAt: new Date(),
      },
    });

    await expect(
      prisma.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: ownerB.id,
          role: OrganizationMemberRole.Owner,
          status: OrganizationMemberStatus.Active,
          joinedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  itIfDb('enforces unique device session refresh token hash', async () => {
    const user = await createTestUser('session-unique');
    const tokenFamily = await prisma.tokenFamily.create({
      data: { userId: user.id },
    });
    const hash = `${TEST_PREFIX}refresh-hash-1`;

    await prisma.deviceSession.create({
      data: {
        userId: user.id,
        tokenFamilyId: tokenFamily.id,
        refreshTokenHash: hash,
        sessionVersion: 1,
        permissionsVersion: 1,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await expect(
      prisma.deviceSession.create({
        data: {
          userId: user.id,
          tokenFamilyId: tokenFamily.id,
          refreshTokenHash: hash,
          sessionVersion: 1,
          permissionsVersion: 1,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      }),
    ).rejects.toThrow();
  });

  itIfDb('cascades user deletion to token families and device sessions', async () => {
    const user = await createTestUser('cascade');
    const tokenFamily = await prisma.tokenFamily.create({
      data: { userId: user.id },
    });
    await prisma.deviceSession.create({
      data: {
        userId: user.id,
        tokenFamilyId: tokenFamily.id,
        refreshTokenHash: `${TEST_PREFIX}cascade-hash`,
        sessionVersion: 1,
        permissionsVersion: 1,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.tokenFamily.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.deviceSession.count({ where: { userId: user.id } })).toBe(0);
  });

  itIfDb('supports soft delete via deletedAt on tenant-owned entities', async () => {
    const user = await createTestUser('soft-delete');
    const organization = await createTestOrganization('soft-delete', user.id);
    const restaurant = await prisma.restaurant.create({
      data: {
        organizationId: organization.id,
        name: 'Soft Delete Restaurant',
        slug: `${TEST_PREFIX}soft-delete-restaurant`,
        status: 'Active',
      },
    });
    const branch = await prisma.branch.create({
      data: {
        restaurantId: restaurant.id,
        city: 'Istanbul',
        address: 'Test Address',
        countryCode: 'TR',
        timezone: 'Europe/Istanbul',
      },
    });
    const role = await prisma.role.create({
      data: {
        name: `${TEST_PREFIX}Soft Role`,
        slug: `${TEST_PREFIX}soft-role`,
        description: 'Test role',
        scope: RoleScope.Restaurant,
      },
    });
    const employee = await prisma.employee.create({
      data: {
        restaurantId: restaurant.id,
        roleId: role.id,
        firstName: 'Soft',
        lastName: 'Employee',
        email: `${TEST_PREFIX}soft-employee@example.com`,
        status: 'Active',
      },
    });

    const deletedAt = new Date();
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt } });
    await prisma.organization.update({
      where: { id: organization.id },
      data: { deletedAt },
    });
    await prisma.restaurant.update({
      where: { id: restaurant.id },
      data: { deletedAt },
    });
    await prisma.branch.update({ where: { id: branch.id }, data: { deletedAt } });
    await prisma.employee.update({
      where: { id: employee.id },
      data: { deletedAt },
    });

    const reloadedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(reloadedUser?.deletedAt).not.toBeNull();
    expect(await prisma.organization.findUnique({ where: { id: organization.id } })).toMatchObject({
      deletedAt: expect.any(Date),
    });
    expect(await prisma.restaurant.findUnique({ where: { id: restaurant.id } })).toMatchObject({
      deletedAt: expect.any(Date),
    });
    expect(await prisma.branch.findUnique({ where: { id: branch.id } })).toMatchObject({
      deletedAt: expect.any(Date),
    });
    expect(await prisma.employee.findUnique({ where: { id: employee.id } })).toMatchObject({
      deletedAt: expect.any(Date),
    });
  });

  itIfDb('enforces role permission shape check constraint', async () => {
    const permission = await prisma.permission.create({
      data: {
        slug: `${TEST_PREFIX}perm-shape`,
        description: 'Shape test permission',
      },
    });
    const role = await prisma.role.create({
      data: {
        name: `${TEST_PREFIX}Shape Role`,
        slug: `${TEST_PREFIX}shape-role`,
        description: 'Shape test role',
        scope: RoleScope.Restaurant,
      },
    });

    await expect(
      prisma.rolePermission.create({
        data: {
          roleId: role.id,
          permissionId: permission.id,
          type: RolePermissionType.IndividualGrant,
        },
      }),
    ).rejects.toThrow();

    await prisma.rolePermission.create({
      data: {
        roleId: role.id,
        permissionId: permission.id,
        type: RolePermissionType.RoleGrant,
      },
    });
  });

  itIfDb('enforces partial unique role grant per role and permission', async () => {
    const permission = await prisma.permission.create({
      data: {
        slug: `${TEST_PREFIX}perm-grant-unique`,
        description: 'Grant unique test',
      },
    });
    const role = await prisma.role.create({
      data: {
        name: `${TEST_PREFIX}Grant Unique Role`,
        slug: `${TEST_PREFIX}grant-unique-role`,
        description: 'Grant unique test role',
        scope: RoleScope.Restaurant,
      },
    });

    await prisma.rolePermission.create({
      data: {
        roleId: role.id,
        permissionId: permission.id,
        type: RolePermissionType.RoleGrant,
      },
    });

    await expect(
      prisma.rolePermission.create({
        data: {
          roleId: role.id,
          permissionId: permission.id,
          type: RolePermissionType.RoleGrant,
        },
      }),
    ).rejects.toThrow();
  });

  itIfDb('enforces unique employee branch assignment', async () => {
    const user = await createTestUser('branch-assign');
    const organization = await createTestOrganization('branch-assign', user.id);
    const restaurant = await prisma.restaurant.create({
      data: {
        organizationId: organization.id,
        name: 'Branch Assign Restaurant',
        slug: `${TEST_PREFIX}branch-assign-restaurant`,
        status: 'Active',
      },
    });
    const branch = await prisma.branch.create({
      data: {
        restaurantId: restaurant.id,
        city: 'Ankara',
        address: 'Branch Address',
        countryCode: 'TR',
        timezone: 'Europe/Istanbul',
      },
    });
    const role = await prisma.role.findFirst({ where: { slug: 'manager' } });
    if (!role) {
      throw new Error('Seed role manager not found — run prisma db seed');
    }
    const employee = await prisma.employee.create({
      data: {
        restaurantId: restaurant.id,
        roleId: role.id,
        firstName: 'Branch',
        lastName: 'Employee',
        email: `${TEST_PREFIX}branch-employee@example.com`,
        status: 'Active',
      },
    });

    await prisma.employeeBranchAssignment.create({
      data: {
        employeeId: employee.id,
        branchId: branch.id,
        assignedAt: new Date(),
      },
    });

    await expect(
      prisma.employeeBranchAssignment.create({
        data: {
          employeeId: employee.id,
          branchId: branch.id,
          assignedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  itIfDb('restricts role deletion when referenced by employee', async () => {
    const user = await createTestUser('role-restrict');
    const organization = await createTestOrganization('role-restrict', user.id);
    const restaurant = await prisma.restaurant.create({
      data: {
        organizationId: organization.id,
        name: 'Role Restrict Restaurant',
        slug: `${TEST_PREFIX}role-restrict-restaurant`,
        status: 'Active',
      },
    });
    const role = await prisma.role.create({
      data: {
        name: `${TEST_PREFIX}Restrict Role`,
        slug: `${TEST_PREFIX}restrict-role`,
        description: 'Restrict delete test',
        scope: RoleScope.Restaurant,
      },
    });
    await prisma.employee.create({
      data: {
        restaurantId: restaurant.id,
        roleId: role.id,
        firstName: 'Restrict',
        lastName: 'Employee',
        email: `${TEST_PREFIX}restrict-employee@example.com`,
        status: 'Active',
      },
    });

    await expect(prisma.role.delete({ where: { id: role.id } })).rejects.toThrow();
  });
});
