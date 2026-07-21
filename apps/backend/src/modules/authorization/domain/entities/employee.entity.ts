import { Entity } from '@shared/domain/base/entity.base';
import {
  BranchId,
  EmployeeId,
  RestaurantId,
  RoleId,
  UserId,
} from '@shared/domain/value-objects/identifiers.vo';
import { EmployeeStatus } from '../enums/authorization.enums';
import { EmployeeDeactivatedException } from '../exceptions/employee-deactivated.exception';
import { EmployeeBranchNotAssignedException } from '../exceptions/employee-branch-not-assigned.exception';

export interface EmployeeProps {
  id: string;
  restaurantId: string;
  roleId: string;
  userId: string | null;
  permissionsVersion: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: EmployeeStatus;
  assignedBranchIds: string[];
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export class Employee extends Entity<EmployeeProps> {
  private constructor(props: EmployeeProps) {
    super(props);
  }

  static create(props: EmployeeProps): Employee {
    if (props.permissionsVersion < 1) {
      throw new Error('permissionsVersion must be >= 1.');
    }
    return new Employee({ ...props });
  }

  static reconstitute(props: EmployeeProps): Employee {
    return new Employee({ ...props });
  }

  get employeeId(): EmployeeId {
    return EmployeeId.create(this.props.id);
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get roleId(): RoleId {
    return RoleId.create(this.props.roleId);
  }

  get userId(): UserId | null {
    return this.props.userId ? UserId.create(this.props.userId) : null;
  }

  get permissionsVersion(): number {
    return this.props.permissionsVersion;
  }

  get status(): EmployeeStatus {
    return this.props.status;
  }

  get firstName(): string {
    return this.props.firstName;
  }

  get lastName(): string {
    return this.props.lastName;
  }

  get email(): string {
    return this.props.email;
  }

  get phone(): string | null {
    return this.props.phone;
  }

  get assignedBranchIds(): readonly string[] {
    return this.props.assignedBranchIds;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  get deletedAt(): Date | null {
    return this.props.deletedAt ? new Date(this.props.deletedAt.getTime()) : null;
  }

  isActive(): boolean {
    return this.props.status === EmployeeStatus.Active && this.props.deletedAt === null;
  }

  canAuthenticate(): void {
    if (!this.isActive()) {
      throw new EmployeeDeactivatedException();
    }
  }

  hasRestaurantWideScope(): boolean {
    return this.props.assignedBranchIds.length === 0;
  }

  assertBranchScope(branchId: BranchId): void {
    if (this.hasRestaurantWideScope()) {
      return;
    }
    const allowed = this.props.assignedBranchIds.includes(branchId.value);
    if (!allowed) {
      throw new EmployeeBranchNotAssignedException();
    }
  }

  bumpPermissionsVersion(at: Date): Employee {
    return Employee.reconstitute({
      ...this.props,
      permissionsVersion: this.props.permissionsVersion + 1,
      updatedAt: at,
    });
  }

  /**
   * Phase 7.0 (Employee Management) - changes ONLY `roleId`, bumping
   * `permissionsVersion` in the same step (AUTHORIZATION_ARCHITECTURE.md §17:
   * "Role change... " bumps `permissionsVersion`, tolerated stale until the
   * access token's natural expiry or next refresh - never `sessionVersion`,
   * see TASKS.md's Phase 7.0 decision note).
   */
  changeRole(roleId: string, at: Date): Employee {
    return Employee.reconstitute({
      ...this.props,
      roleId,
      permissionsVersion: this.props.permissionsVersion + 1,
      updatedAt: at,
    });
  }

  /**
   * Phase 7.0 - adds one branch to this Employee's scope. The caller
   * (`AssignEmployeeToBranchUseCase`) is responsible for verifying the branch
   * exists, belongs to this Employee's own restaurant, and is not already
   * assigned (idempotency/duplicate-assignment guard lives at the use-case
   * level, mirroring `EmployeeBranchAssignment`'s own unique constraint as the
   * database-level safety net). Bumps `permissionsVersion` - branch scope is
   * part of effective access (AUTHORIZATION_ARCHITECTURE.md §17).
   */
  assignBranch(branchId: string, at: Date): Employee {
    return Employee.reconstitute({
      ...this.props,
      assignedBranchIds: [...this.props.assignedBranchIds, branchId],
      permissionsVersion: this.props.permissionsVersion + 1,
      updatedAt: at,
    });
  }

  /**
   * Phase 7.0 - removes one branch from this Employee's scope. Removing the
   * last explicit assignment restores restaurant-wide scope
   * (`hasRestaurantWideScope()` becomes true again), matching this entity's
   * existing "empty list = restaurant-wide" convention - not an error case.
   */
  unassignBranch(branchId: string, at: Date): Employee {
    return Employee.reconstitute({
      ...this.props,
      assignedBranchIds: this.props.assignedBranchIds.filter((id) => id !== branchId),
      permissionsVersion: this.props.permissionsVersion + 1,
      updatedAt: at,
    });
  }

  /**
   * Phase 7.0 - first-login linking (AUTHENTICATION_ARCHITECTURE.md §1.2:
   * "Employee invite: Pre-created Employee linked on first login"). Transitions
   * `Invited` -> `Active` and sets `userId`. Called at most once per Employee,
   * from `LoginUseCase` only (never `RefreshSessionUseCase` - TASKS.md's
   * Phase 7.0 decision note item 5).
   */
  activateAndLink(userId: string, at: Date): Employee {
    return Employee.reconstitute({
      ...this.props,
      userId,
      status: EmployeeStatus.Active,
      updatedAt: at,
    });
  }

  /**
   * Phase 7.0 - "Remove Employee" is a soft delete only (ADR-010 convention),
   * matching every other aggregate; `EmployeeStatus` is left untouched (see
   * TASKS.md's Phase 7.0 decision note item 1 - no separate `Deactivated`
   * status flip for this action).
   */
  softDelete(at: Date): Employee {
    return Employee.reconstitute({
      ...this.props,
      deletedAt: at,
      updatedAt: at,
    });
  }

  toProps(): Readonly<EmployeeProps> {
    return { ...this.props };
  }
}
