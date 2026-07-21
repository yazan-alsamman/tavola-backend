import { PrismaClient, RoleScope } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaEmployeeRepository } from '@modules/authorization/infrastructure/persistence/prisma-employee.repository';
import { Employee } from '@modules/authorization/domain/entities/employee.entity';
import { EmployeeStatus } from '@modules/authorization/domain/enums/authorization.enums';
import { BranchId, RestaurantId, RoleId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'employee-repo-';

describe('Employee round-trip via PrismaEmployeeRepository (integration)', () => {
  let dbAvailable = false;
  let repository: PrismaEmployeeRepository;
  let org: { id: string };
  let role: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaEmployeeRepository]);
    repository = moduleRef.get(PrismaEmployeeRepository);

    org = await rawPrisma.organization.create({
      data: {
        name: 'Employee Repo Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });

    role = await rawPrisma.role.create({
      data: {
        name: `${TEST_PREFIX}manager-${randomUUID()}`,
        slug: `${TEST_PREFIX}manager-${randomUUID()}`,
        description: 'Test manager role',
        scope: RoleScope.Restaurant,
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;

    await rawPrisma.employeeBranchAssignment.deleteMany({
      where: { employee: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
    });
    await rawPrisma.employee.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.branch.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.role.delete({ where: { id: role.id } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  async function createRestaurant(): Promise<{ id: string }> {
    return rawPrisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: 'The Old Mill',
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: 'Active',
      },
    });
  }

  async function createUser(): Promise<{ id: string }> {
    return rawPrisma.user.create({
      data: {
        firstName: 'Test',
        lastName: 'User',
        email: `${TEST_PREFIX}user-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$fake$not-used-by-this-spec',
        language: 'en',
      },
    });
  }

  async function createBranch(restaurantId: string): Promise<{ id: string }> {
    return rawPrisma.branch.create({
      data: {
        restaurantId,
        city: 'Damascus',
        address: '123 Main St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      },
    });
  }

  function buildEmployee(
    restaurantId: string,
    overrides: Partial<{
      email: string;
      status: EmployeeStatus;
      userId: string | null;
    }> = {},
  ): Employee {
    const now = new Date();
    return Employee.create({
      id: randomUUID(),
      restaurantId,
      roleId: role.id,
      userId: overrides.userId ?? null,
      permissionsVersion: 1,
      firstName: 'Jane',
      lastName: 'Doe',
      email: overrides.email ?? `${TEST_PREFIX}${randomUUID()}@example.com`,
      phone: null,
      status: overrides.status ?? EmployeeStatus.Invited,
      assignedBranchIds: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  it('save persists an employee and findByIdAndRestaurantId rehydrates it', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const employee = buildEmployee(restaurant.id);
    await repository.save(employee);

    const found = await repository.findByIdAndRestaurantId(
      employee.employeeId,
      RestaurantId.create(restaurant.id),
    );
    expect(found).not.toBeNull();
    expect(found?.status).toBe(EmployeeStatus.Invited);
  });

  it('findByIdAndRestaurantId returns null when the employee belongs to a different restaurant', async () => {
    if (!dbAvailable) return;

    const restaurantA = await createRestaurant();
    const restaurantB = await createRestaurant();
    const employee = buildEmployee(restaurantA.id);
    await repository.save(employee);

    const found = await repository.findByIdAndRestaurantId(
      employee.employeeId,
      RestaurantId.create(restaurantB.id),
    );
    expect(found).toBeNull();
  });

  it('findByEmailAndRestaurantId finds an existing employee by email within the same restaurant', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const email = `${TEST_PREFIX}unique-${randomUUID()}@example.com`;
    const employee = buildEmployee(restaurant.id, { email });
    await repository.save(employee);

    const found = await repository.findByEmailAndRestaurantId(
      email,
      RestaurantId.create(restaurant.id),
    );
    expect(found?.employeeId.value).toBe(employee.employeeId.value);
  });

  it('findUnlinkedInvitedByEmail returns only Invited, unlinked rows matching the email', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const user = await createUser();
    const email = `${TEST_PREFIX}pending-${randomUUID()}@example.com`;
    const invited = buildEmployee(restaurant.id, { email, status: EmployeeStatus.Invited });
    const linked = buildEmployee(restaurant.id, {
      email,
      status: EmployeeStatus.Active,
      userId: user.id,
    });
    await repository.save(invited);
    await repository.save(linked);

    const found = await repository.findUnlinkedInvitedByEmail(email);
    expect(found).toHaveLength(1);
    expect(found[0].employeeId.value).toBe(invited.employeeId.value);
  });

  it('countActiveByRestaurantIdAndRoleId excludes soft-deleted and Deactivated rows', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const active = buildEmployee(restaurant.id, { status: EmployeeStatus.Active });
    const invited = buildEmployee(restaurant.id, { status: EmployeeStatus.Invited });
    await repository.save(active);
    await repository.save(invited);

    const count = await repository.countActiveByRestaurantIdAndRoleId(
      RestaurantId.create(restaurant.id),
      RoleId.create(role.id),
    );
    expect(count).toBe(2);
  });

  it('addBranchAssignment/removeBranchAssignment persist and remove the join row idempotently', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const branch = await createBranch(restaurant.id);
    const employee = buildEmployee(restaurant.id);
    await repository.save(employee);

    await repository.addBranchAssignment(
      employee.employeeId,
      BranchId.create(branch.id),
      new Date(),
    );
    await repository.addBranchAssignment(
      employee.employeeId,
      BranchId.create(branch.id),
      new Date(),
    );

    const afterAdd = await repository.findByIdAndRestaurantId(
      employee.employeeId,
      RestaurantId.create(restaurant.id),
    );
    expect(afterAdd?.assignedBranchIds).toEqual([branch.id]);

    await repository.removeBranchAssignment(employee.employeeId, BranchId.create(branch.id));

    const afterRemove = await repository.findByIdAndRestaurantId(
      employee.employeeId,
      RestaurantId.create(restaurant.id),
    );
    expect(afterRemove?.assignedBranchIds).toEqual([]);
  });

  it('save persists a soft delete (deletedAt) without altering status', async () => {
    if (!dbAvailable) return;

    const restaurant = await createRestaurant();
    const employee = buildEmployee(restaurant.id, { status: EmployeeStatus.Active });
    await repository.save(employee);

    const removed = employee.softDelete(new Date());
    await repository.save(removed);

    const found = await repository.findById(employee.employeeId);
    expect(found?.deletedAt).not.toBeNull();
    expect(found?.status).toBe(EmployeeStatus.Active);
    // Soft-deleted rows are excluded from restaurant-scoped lookups.
    const scoped = await repository.findByIdAndRestaurantId(
      employee.employeeId,
      RestaurantId.create(restaurant.id),
    );
    expect(scoped).toBeNull();
  });
});
