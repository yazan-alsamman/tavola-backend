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

  toProps(): Readonly<EmployeeProps> {
    return { ...this.props };
  }
}
