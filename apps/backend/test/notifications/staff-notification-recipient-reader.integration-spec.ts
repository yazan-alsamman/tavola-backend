import { randomUUID } from 'crypto';
import { PrismaClient, RolePermissionType, UserStatus } from '@prisma/client';
import { PrismaStaffNotificationRecipientReader } from '@modules/notifications/infrastructure/persistence/prisma-staff-notification-recipient.reader';
import { CONVERSATIONS_MANAGE_PERMISSION } from '@modules/messaging/application/services/assert-actor-can-manage-conversation';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const prisma = new PrismaClient();
const TEST_PREFIX = 'staff-recipients-integration-';

/**
 * Who hears about customer activity (EVENTS.md "Restaurant-side In-App
 * notifications"), and - for a message (ADR-049) - only the staff who may
 * answer it: Owner/Admin, or an Employee with an effective
 * `conversations:manage` in the conversation's branch scope.
 */
describe('PrismaStaffNotificationRecipientReader (integration)', () => {
  let reader: PrismaStaffNotificationRecipientReader;
  let dbAvailable = false;

  let restaurantId: string;
  let branchId: string;
  let otherBranchId: string;
  let ownerUserId: string;
  let billingUserId: string;
  /** receptionist (role grants conversations:manage), assigned to `branchId`. */
  let receptionistUserId: string;
  /** manager with no branch assignment = restaurant-wide. */
  let managerUserId: string;
  /** receptionist assigned only to `otherBranchId`. */
  let otherBranchReceptionistUserId: string;
  /** cashier (role lacks it) with an individual grant. */
  let grantedCashierUserId: string;
  /** cashier without the permission. */
  let cashierUserId: string;
  /** manager whose permission is individually revoked. */
  let revokedManagerUserId: string;

  async function seedUser(label: string): Promise<string> {
    const user = await prisma.user.create({
      data: {
        firstName: label,
        lastName: 'Fixture',
        email: `${TEST_PREFIX}${label}-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });
    return user.id;
  }

  async function roleId(slug: string): Promise<string> {
    const role = await prisma.role.findUniqueOrThrow({ where: { slug } });
    return role.id;
  }

  async function seedEmployee(
    label: string,
    roleSlug: string,
    branchIds: string[],
  ): Promise<{ userId: string; employeeId: string }> {
    const userId = await seedUser(label);
    const employee = await prisma.employee.create({
      data: {
        restaurantId,
        roleId: await roleId(roleSlug),
        userId,
        firstName: label,
        lastName: 'Fixture',
        email: `${TEST_PREFIX}${label}@example.com`,
        status: 'Active',
      },
    });
    for (const id of branchIds) {
      await prisma.employeeBranchAssignment.create({
        data: { employeeId: employee.id, branchId: id, assignedAt: new Date() },
      });
    }
    return { userId, employeeId: employee.id };
  }

  async function individualRow(employeeId: string, type: RolePermissionType): Promise<void> {
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { slug: CONVERSATIONS_MANAGE_PERMISSION },
    });
    await prisma.rolePermission.create({
      data: { employeeId, permissionId: permission.id, type },
    });
  }

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }
    const moduleRef = await createPrismaIntegrationModule([PrismaStaffNotificationRecipientReader]);
    reader = moduleRef.get(PrismaStaffNotificationRecipientReader);

    const org = await prisma.organization.create({
      data: {
        name: 'Staff Recipients Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}${randomUUID()}@example.com`,
      },
    });
    const restaurant = await prisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: 'Staff Recipients Bistro',
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: 'Active',
      },
    });
    restaurantId = restaurant.id;
    const branchData = {
      restaurantId,
      city: 'Damascus',
      address: '1 Recipient St',
      countryCode: 'SY',
      timezone: 'Asia/Damascus',
    };
    branchId = (await prisma.branch.create({ data: branchData })).id;
    otherBranchId = (await prisma.branch.create({ data: branchData })).id;

    ownerUserId = await seedUser('owner');
    billingUserId = await seedUser('billing');
    await prisma.organizationMember.createMany({
      data: [
        { organizationId: org.id, userId: ownerUserId, role: 'Owner', status: 'Active' },
        { organizationId: org.id, userId: billingUserId, role: 'Billing', status: 'Active' },
      ],
    });

    receptionistUserId = (await seedEmployee('receptionist', 'receptionist', [branchId])).userId;
    managerUserId = (await seedEmployee('manager', 'manager', [])).userId;
    otherBranchReceptionistUserId = (
      await seedEmployee('other-receptionist', 'receptionist', [otherBranchId])
    ).userId;
    const grantedCashier = await seedEmployee('granted-cashier', 'cashier', [branchId]);
    grantedCashierUserId = grantedCashier.userId;
    await individualRow(grantedCashier.employeeId, RolePermissionType.IndividualGrant);
    cashierUserId = (await seedEmployee('cashier', 'cashier', [branchId])).userId;
    const revokedManager = await seedEmployee('revoked-manager', 'manager', [branchId]);
    revokedManagerUserId = revokedManager.userId;
    await individualRow(revokedManager.employeeId, RolePermissionType.IndividualRevocation);
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await prisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  it('without a permission, keeps the branch-scope rule for every employee', async () => {
    if (!dbAvailable) return;
    const ids = await reader.findRecipientUserIds(restaurantId, branchId);
    expect(new Set(ids)).toEqual(
      new Set([
        ownerUserId,
        receptionistUserId,
        managerUserId,
        grantedCashierUserId,
        cashierUserId,
        revokedManagerUserId,
      ]),
    );
  });

  it('with conversations:manage, keeps only employees whose effective permissions include it', async () => {
    if (!dbAvailable) return;
    const ids = await reader.findRecipientUserIds(
      restaurantId,
      branchId,
      CONVERSATIONS_MANAGE_PERMISSION,
    );
    expect(new Set(ids)).toEqual(
      new Set([ownerUserId, receptionistUserId, managerUserId, grantedCashierUserId]),
    );
  });

  it('for a restaurant-wide conversation (no branch), reaches every permitted employee', async () => {
    if (!dbAvailable) return;
    const ids = await reader.findRecipientUserIds(
      restaurantId,
      null,
      CONVERSATIONS_MANAGE_PERMISSION,
    );
    expect(new Set(ids)).toEqual(
      new Set([
        ownerUserId,
        receptionistUserId,
        managerUserId,
        otherBranchReceptionistUserId,
        grantedCashierUserId,
      ]),
    );
    expect(ids).not.toContain(billingUserId);
  });
});
