import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { RbacPermissionResolver } from '@modules/authorization/application/resolvers/rbac-permission-resolver';
import {
  EMPLOYEE_REPOSITORY,
  ROLE_PERMISSION_REPOSITORY,
} from '@modules/authorization/application/tokens/authorization.tokens';
import { PrismaEmployeeRepository } from '@modules/authorization/infrastructure/persistence/prisma-employee.repository';
import { PrismaRolePermissionRepository } from '@modules/authorization/infrastructure/persistence/prisma-role-permission.repository';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * Phase 2.14 - proves `RbacPermissionResolver` end to end against real
 * PostgreSQL: the DI-wired `PrismaEmployeeRepository`/`PrismaRolePermissionRepository`,
 * the Employee -> Restaurant -> organizationId join, and the domain
 * `PermissionResolver` formula (RoleGrant ∪ IndividualGrant - IndividualRevocation).
 */

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'rbac-resolver-';

describe('RbacPermissionResolver (integration)', () => {
  let dbAvailable = false;
  let resolver: RbacPermissionResolver;

  const organizationId = randomUUID();
  const restaurantId = randomUUID();
  const roleId = randomUUID();
  const linkedUserId = randomUUID();
  const unlinkedUserId = randomUUID();
  const deactivatedUserId = randomUUID();
  const employeeId = randomUUID();
  const deactivatedEmployeeId = randomUUID();
  const branchId = randomUUID();
  const permissionApproveId = randomUUID();
  const permissionManageId = randomUUID();
  const permissionViewId = randomUUID();
  // Prefixed/unique per run - the foundation seed already owns the real
  // `reservations:approve`/`tables:manage`/`reports:view` slugs (unique
  // constraint), so this test uses its own distinct slugs entirely.
  const approveSlug = `${TEST_PREFIX}reservations-approve-${randomUUID()}`;
  const manageSlug = `${TEST_PREFIX}tables-manage-${randomUUID()}`;
  const viewSlug = `${TEST_PREFIX}reports-view-${randomUUID()}`;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaEmployeeRepository,
      PrismaRolePermissionRepository,
      RbacPermissionResolver,
      { provide: EMPLOYEE_REPOSITORY, useExisting: PrismaEmployeeRepository },
      { provide: ROLE_PERMISSION_REPOSITORY, useExisting: PrismaRolePermissionRepository },
    ]);
    resolver = moduleRef.get(RbacPermissionResolver);

    const organization = await rawPrisma.organization.create({
      data: {
        id: organizationId,
        name: 'RBAC Resolver Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}billing@example.com`,
      },
    });

    await rawPrisma.restaurant.create({
      data: {
        id: restaurantId,
        organizationId: organization.id,
        name: 'RBAC Resolver Restaurant',
        slug: `${TEST_PREFIX}restaurant-${randomUUID()}`,
        status: 'Active',
      },
    });

    await rawPrisma.branch.create({
      data: {
        id: branchId,
        restaurantId,
        city: 'Test City',
        address: '1 Test Street',
        countryCode: 'US',
        timezone: 'UTC',
      },
    });

    await rawPrisma.role.create({
      data: {
        id: roleId,
        name: `${TEST_PREFIX}Manager-${randomUUID()}`,
        slug: `${TEST_PREFIX}manager-${randomUUID()}`,
        description: 'Test manager role',
        scope: 'Restaurant',
      },
    });

    await rawPrisma.permission.createMany({
      data: [
        { id: permissionApproveId, slug: approveSlug, description: 'Approve' },
        { id: permissionManageId, slug: manageSlug, description: 'Manage tables' },
        { id: permissionViewId, slug: viewSlug, description: 'View reports' },
      ],
    });

    await rawPrisma.rolePermission.createMany({
      data: [
        { roleId, permissionId: permissionApproveId, type: 'RoleGrant' },
        { roleId, permissionId: permissionManageId, type: 'RoleGrant' },
      ],
    });

    for (const [id, email] of [
      [linkedUserId, `${TEST_PREFIX}linked@example.com`],
      [unlinkedUserId, `${TEST_PREFIX}unlinked@example.com`],
      [deactivatedUserId, `${TEST_PREFIX}deactivated@example.com`],
    ] as const) {
      await rawPrisma.user.create({
        data: {
          id,
          firstName: 'RBAC',
          lastName: 'Resolver',
          email,
          passwordHash: 'argon2id$test',
          language: 'en',
          status: 'Active',
          emailVerified: true,
        },
      });
    }

    await rawPrisma.employee.create({
      data: {
        id: employeeId,
        restaurantId,
        roleId,
        userId: linkedUserId,
        firstName: 'Linked',
        lastName: 'Employee',
        email: `${TEST_PREFIX}employee@example.com`,
        status: 'Active',
      },
    });

    await rawPrisma.employeeBranchAssignment.create({
      data: {
        employeeId,
        branchId,
        assignedAt: new Date(),
      },
    });

    // Individual override for the linked employee: grant a permission the
    // role doesn't carry, revoke one it does.
    await rawPrisma.rolePermission.createMany({
      data: [
        { employeeId, permissionId: permissionViewId, type: 'IndividualGrant' },
        { employeeId, permissionId: permissionManageId, type: 'IndividualRevocation' },
      ],
    });

    await rawPrisma.employee.create({
      data: {
        id: deactivatedEmployeeId,
        restaurantId,
        roleId,
        userId: deactivatedUserId,
        firstName: 'Deactivated',
        lastName: 'Employee',
        email: `${TEST_PREFIX}deactivated-employee@example.com`,
        status: 'Deactivated',
      },
    });
  });

  afterAll(async () => {
    if (dbAvailable) {
      await rawPrisma.rolePermission.deleteMany({
        where: { OR: [{ roleId }, { employeeId: { in: [employeeId, deactivatedEmployeeId] } }] },
      });
      await rawPrisma.employeeBranchAssignment.deleteMany({ where: { employeeId } });
      await rawPrisma.employee.deleteMany({
        where: { id: { in: [employeeId, deactivatedEmployeeId] } },
      });
      await rawPrisma.permission.deleteMany({
        where: { id: { in: [permissionApproveId, permissionManageId, permissionViewId] } },
      });
      await rawPrisma.role.deleteMany({ where: { id: roleId } });
      await rawPrisma.user.deleteMany({
        where: { id: { in: [linkedUserId, unlinkedUserId, deactivatedUserId] } },
      });
      await rawPrisma.branch.deleteMany({ where: { id: branchId } });
      await rawPrisma.restaurant.deleteMany({ where: { id: restaurantId } });
      await rawPrisma.organization.deleteMany({ where: { id: organizationId } });
      await rawPrisma.$disconnect();
    }
  });

  it('returns null for a user with no Employee record', async () => {
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const result = await resolver.resolveForUserId(UserId.create(unlinkedUserId));
    expect(result).toBeNull();
  });

  it('returns null for a deactivated Employee', async () => {
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const result = await resolver.resolveForUserId(UserId.create(deactivatedUserId));
    expect(result).toBeNull();
  });

  it('resolves the organizationId via the Restaurant join and effective permissions with revocation-beats-grant', async () => {
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const result = await resolver.resolveForUserId(UserId.create(linkedUserId));

    expect(result).not.toBeNull();
    expect(result!.employeeId).toBe(employeeId);
    expect(result!.organizationId).toBe(organizationId);
    expect(result!.restaurantId).toBe(restaurantId);
    expect(result!.branchIds).toEqual([branchId]);
    expect(result!.permissionsVersion).toBe(1);
    expect(new Set(result!.permissions)).toEqual(new Set([approveSlug, viewSlug]));
    expect(result!.permissions).not.toContain(manageSlug);
  });
});
