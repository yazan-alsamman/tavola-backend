import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { Employee } from '../entities/employee.entity';
import {
  RoleId,
  PermissionId,
  EmployeeId,
  RestaurantId,
  BranchId,
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
  /**
   * Filters by both `id` AND `restaurantId` in one query - not `findById`
   * followed by a manual comparison - so an employee belonging to a
   * different restaurant than the one named in the URL is indistinguishable
   * from "does not exist" (IDOR protection), mirroring
   * `BranchRepository.findByIdAndRestaurantId`'s own convention.
   */
  findByIdAndRestaurantId(id: EmployeeId, restaurantId: RestaurantId): Promise<Employee | null>;
  /**
   * Phase 7.0 invite-uniqueness check: is there already a non-deleted
   * Employee with this email at this restaurant? `email` carries only a
   * plain index (not a unique constraint) since the same email may
   * legitimately be invited at multiple restaurants.
   */
  findByEmailAndRestaurantId(email: string, restaurantId: RestaurantId): Promise<Employee | null>;
  /**
   * Phase 7.0 first-login linking lookup (AUTHENTICATION_ARCHITECTURE.md
   * §1.2): every `Invited`, not-yet-linked (`userId IS NULL`) Employee row
   * matching this email, across every restaurant that invited it - `Login`
   * links all of them to the same authenticating `User` in one pass.
   */
  findUnlinkedInvitedByEmail(email: string): Promise<Employee[]>;
  /**
   * Phase 7.0 "cannot remove the last Manager" invariant
   * (AUTHORIZATION_ARCHITECTURE.md §19) - counts non-deleted, non-`Deactivated`
   * Employees holding the given role at the given restaurant.
   */
  countActiveByRestaurantIdAndRoleId(restaurantId: RestaurantId, roleId: RoleId): Promise<number>;
  save(employee: Employee): Promise<void>;
  /**
   * Phase 7.0 - `EmployeeBranchAssignment` is a join row, not a column on
   * `Employee`, so it is never touched by `save()`. Idempotent: assigning an
   * already-assigned branch is a no-op (the use case checks first; the
   * underlying unique constraint is the database-level safety net).
   */
  addBranchAssignment(employeeId: EmployeeId, branchId: BranchId, at: Date): Promise<void>;
  removeBranchAssignment(employeeId: EmployeeId, branchId: BranchId): Promise<void>;
  /**
   * Login/refresh-time lookup: is this user an active, linked Employee, and
   * if so which organization does their Restaurant belong to? Returns null
   * for users with no Employee record (the common case) or a
   * deactivated/unlinked one.
   */
  findActiveAuthContextByUserId(userId: UserId): Promise<EmployeeAuthContext | null>;
}
