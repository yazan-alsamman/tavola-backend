import { Employee } from '@modules/authorization/domain/entities/employee.entity';
import { EmployeeResult } from '../dto/employee.result';

export function toEmployeeResult(employee: Employee): EmployeeResult {
  return {
    employeeId: employee.employeeId.value,
    restaurantId: employee.restaurantId.value,
    roleId: employee.roleId.value,
    userId: employee.userId?.value ?? null,
    firstName: employee.firstName,
    lastName: employee.lastName,
    email: employee.email,
    phone: employee.phone,
    status: employee.status,
    assignedBranchIds: [...employee.assignedBranchIds],
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  };
}
