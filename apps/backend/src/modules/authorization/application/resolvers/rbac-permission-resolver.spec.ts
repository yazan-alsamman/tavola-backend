import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { Employee } from '../../domain/entities/employee.entity';
import { EmployeeStatus, RolePermissionType } from '../../domain/enums/authorization.enums';
import {
  EmployeeAuthContext,
  EmployeeRepository,
  RolePermissionRepository,
} from '../../domain/repositories/authorization.repositories';
import { PermissionGrantRecord } from '../../domain/services/permission-resolver';
import { RolePermission } from '../../domain/entities/role-permission.entity';
import { RbacPermissionResolver } from './rbac-permission-resolver';

const fixedNow = new Date('2026-07-11T00:00:00.000Z');

function createEmployee(overrides?: Partial<Parameters<typeof Employee.reconstitute>[0]>) {
  return Employee.reconstitute({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    restaurantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    roleId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    userId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    permissionsVersion: 1,
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: null,
    status: EmployeeStatus.Active,
    assignedBranchIds: [],
    createdAt: fixedNow,
    updatedAt: fixedNow,
    deletedAt: null,
    ...overrides,
  });
}

class InMemoryEmployeeRepository implements EmployeeRepository {
  constructor(private context: EmployeeAuthContext | null) {}

  async findById(): Promise<Employee | null> {
    return this.context?.employee ?? null;
  }

  async findByIdAndRestaurantId(): Promise<Employee | null> {
    // not exercised by this resolver (Phase 7.0)
    return this.context?.employee ?? null;
  }

  async findByEmailAndRestaurantId(): Promise<Employee | null> {
    // not exercised by this resolver (Phase 7.0)
    return null;
  }

  async findUnlinkedInvitedByEmail(): Promise<Employee[]> {
    // not exercised by this resolver (Phase 7.0)
    return [];
  }

  async countActiveByRestaurantIdAndRoleId(): Promise<number> {
    // not exercised by this resolver (Phase 7.0)
    return 0;
  }

  async save(): Promise<void> {
    // not exercised by this resolver
  }

  async addBranchAssignment(): Promise<void> {
    // not exercised by this resolver (Phase 7.0)
  }

  async removeBranchAssignment(): Promise<void> {
    // not exercised by this resolver (Phase 7.0)
  }

  async findActiveAuthContextByUserId(): Promise<EmployeeAuthContext | null> {
    return this.context;
  }
}

class InMemoryRolePermissionRepository implements RolePermissionRepository {
  constructor(private grantRecords: PermissionGrantRecord[]) {}

  async findByRoleId(): Promise<RolePermission[]> {
    return [];
  }

  async findByEmployeeId(): Promise<RolePermission[]> {
    return [];
  }

  async save(): Promise<void> {
    // not exercised by this resolver
  }

  async findGrantRecordsForEmployee(): Promise<PermissionGrantRecord[]> {
    return this.grantRecords;
  }
}

describe('RbacPermissionResolver', () => {
  it('returns null when the user has no active Employee record', async () => {
    const resolver = new RbacPermissionResolver(
      new InMemoryEmployeeRepository(null),
      new InMemoryRolePermissionRepository([]),
    );

    const result = await resolver.resolveForUserId(
      UserId.create('11111111-1111-4111-8111-111111111111'),
    );

    expect(result).toBeNull();
  });

  it('resolves effective permissions, revocation-beats-grant, for a restaurant-wide employee', async () => {
    const employee = createEmployee();
    const resolver = new RbacPermissionResolver(
      new InMemoryEmployeeRepository({ employee, organizationId: 'org-1' }),
      new InMemoryRolePermissionRepository([
        { slug: 'reservations:approve', type: RolePermissionType.RoleGrant },
        { slug: 'tables:manage', type: RolePermissionType.RoleGrant },
        { slug: 'reports:view', type: RolePermissionType.IndividualGrant },
        { slug: 'tables:manage', type: RolePermissionType.IndividualRevocation },
      ]),
    );

    const result = await resolver.resolveForUserId(
      UserId.create('11111111-1111-4111-8111-111111111111'),
    );

    expect(result).not.toBeNull();
    expect(result!.employeeId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(result!.organizationId).toBe('org-1');
    expect(result!.restaurantId).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(result!.branchIds).toEqual([]);
    expect(result!.permissionsVersion).toBe(1);
    expect(new Set(result!.permissions)).toEqual(new Set(['reservations:approve', 'reports:view']));
    expect(result!.permissions).not.toContain('tables:manage');
  });

  it('reports branch-restricted scope when the employee has branch assignments', async () => {
    const employee = createEmployee({ assignedBranchIds: ['branch-1', 'branch-2'] });
    const resolver = new RbacPermissionResolver(
      new InMemoryEmployeeRepository({ employee, organizationId: 'org-1' }),
      new InMemoryRolePermissionRepository([
        { slug: 'reservations:create', type: RolePermissionType.RoleGrant },
      ]),
    );

    const result = await resolver.resolveForUserId(
      UserId.create('11111111-1111-4111-8111-111111111111'),
    );

    expect(result!.branchIds).toEqual(['branch-1', 'branch-2']);
  });

  it('reflects the employee permissionsVersion, not a hardcoded value', async () => {
    const employee = createEmployee({ permissionsVersion: 7 });
    const resolver = new RbacPermissionResolver(
      new InMemoryEmployeeRepository({ employee, organizationId: 'org-1' }),
      new InMemoryRolePermissionRepository([]),
    );

    const result = await resolver.resolveForUserId(
      UserId.create('11111111-1111-4111-8111-111111111111'),
    );

    expect(result!.permissionsVersion).toBe(7);
    expect(result!.permissions).toEqual([]);
  });
});
