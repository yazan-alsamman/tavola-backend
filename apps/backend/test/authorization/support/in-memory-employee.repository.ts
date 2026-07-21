import { Employee } from '@modules/authorization/domain/entities/employee.entity';
import { EmployeeStatus } from '@modules/authorization/domain/enums/authorization.enums';
import {
  EmployeeAuthContext,
  EmployeeRepository,
} from '@modules/authorization/domain/repositories/authorization.repositories';
import {
  BranchId,
  EmployeeId,
  RestaurantId,
  RoleId,
  UserId,
} from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryEmployeeRepository implements EmployeeRepository {
  private readonly employees = new Map<string, Employee>();
  private readonly branchAssignments = new Map<string, Set<string>>();
  /** Maps employeeId -> the organizationId its Restaurant belongs to, for `findActiveAuthContextByUserId`. */
  private readonly organizationIdByEmployeeId = new Map<string, string>();

  async findById(id: EmployeeId): Promise<Employee | null> {
    return this.employees.get(id.value) ?? null;
  }

  async findByIdAndRestaurantId(
    id: EmployeeId,
    restaurantId: RestaurantId,
  ): Promise<Employee | null> {
    const employee = this.employees.get(id.value);
    if (!employee || employee.restaurantId.value !== restaurantId.value || employee.deletedAt) {
      return null;
    }
    return employee;
  }

  async findByEmailAndRestaurantId(
    email: string,
    restaurantId: RestaurantId,
  ): Promise<Employee | null> {
    for (const employee of this.employees.values()) {
      if (
        employee.email === email &&
        employee.restaurantId.value === restaurantId.value &&
        !employee.deletedAt
      ) {
        return employee;
      }
    }
    return null;
  }

  async findUnlinkedInvitedByEmail(email: string): Promise<Employee[]> {
    return Array.from(this.employees.values()).filter(
      (employee) =>
        employee.email === email &&
        employee.status === EmployeeStatus.Invited &&
        employee.userId === null &&
        !employee.deletedAt,
    );
  }

  async countActiveByRestaurantIdAndRoleId(
    restaurantId: RestaurantId,
    roleId: RoleId,
  ): Promise<number> {
    let count = 0;
    for (const employee of this.employees.values()) {
      if (
        employee.restaurantId.value === restaurantId.value &&
        employee.roleId.value === roleId.value &&
        employee.status !== EmployeeStatus.Deactivated &&
        !employee.deletedAt
      ) {
        count += 1;
      }
    }
    return count;
  }

  async save(employee: Employee): Promise<void> {
    this.employees.set(employee.employeeId.value, employee);
  }

  async addBranchAssignment(employeeId: EmployeeId, branchId: BranchId): Promise<void> {
    const set = this.branchAssignments.get(employeeId.value) ?? new Set<string>();
    set.add(branchId.value);
    this.branchAssignments.set(employeeId.value, set);
  }

  async removeBranchAssignment(employeeId: EmployeeId, branchId: BranchId): Promise<void> {
    this.branchAssignments.get(employeeId.value)?.delete(branchId.value);
  }

  async findActiveAuthContextByUserId(userId: UserId): Promise<EmployeeAuthContext | null> {
    for (const employee of this.employees.values()) {
      if (
        employee.userId?.value === userId.value &&
        employee.status === EmployeeStatus.Active &&
        !employee.deletedAt
      ) {
        const organizationId = this.organizationIdByEmployeeId.get(employee.employeeId.value);
        if (organizationId === undefined) {
          return null;
        }
        return { employee, organizationId };
      }
    }
    return null;
  }

  /** Test-only helper: registers which organization an Employee's Restaurant belongs to. */
  setOrganizationForEmployee(employeeId: string, organizationId: string): void {
    this.organizationIdByEmployeeId.set(employeeId, organizationId);
  }
}
