import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { Employee } from '../entities/employee.entity';
import {
  RoleId,
  PermissionId,
  EmployeeId,
  UserId,
} from '@shared/domain/value-objects/identifiers.vo';
import { PermissionSlug } from '@shared/domain/value-objects/permission-slug.vo';
import { RoleSlug } from '@shared/domain/value-objects/role-slug.vo';
import { PermissionGrantRecord } from '../services/permission-resolver';

export interface RoleRepository {
  findById(id: RoleId): Promise<Role | null>;
  findBySlug(slug: RoleSlug): Promise<Role | null>;
  save(role: Role): Promise<void>;
}

export interface PermissionRepository {
  findById(id: PermissionId): Promise<Permission | null>;
  findBySlug(slug: PermissionSlug): Promise<Permission | null>;
  findBySlugs(slugs: PermissionSlug[]): Promise<Permission[]>;
  save(permission: Permission): Promise<void>;
}

export interface RolePermissionRepository {
  findByRoleId(roleId: RoleId): Promise<RolePermission[]>;
  findByEmployeeId(employeeId: EmployeeId): Promise<RolePermission[]>;
  save(rolePermission: RolePermission): Promise<void>;
  /**
   * Single joined read of every grant/revocation relevant to one employee's
   * effective permission set: role-level grants for their role plus their own
   * individual overrides. Purpose-built for `PermissionResolver` consumers so
   * they never issue two round trips and re-join in application code.
   */
  findGrantRecordsForEmployee(
    roleId: RoleId,
    employeeId: EmployeeId,
  ): Promise<PermissionGrantRecord[]>;
}

/** Everything an authorization resolution needs about an Employee's tenancy anchor. */
export interface EmployeeAuthContext {
  employee: Employee;
  organizationId: string;
}

export interface EmployeeRepository {
  findById(id: EmployeeId): Promise<Employee | null>;
  save(employee: Employee): Promise<void>;
  /**
   * Login/refresh-time lookup: is this user an active, linked Employee, and
   * if so which organization does their Restaurant belong to? Returns null
   * for users with no Employee record (the common case) or a
   * deactivated/unlinked one.
   */
  findActiveAuthContextByUserId(userId: UserId): Promise<EmployeeAuthContext | null>;
}
