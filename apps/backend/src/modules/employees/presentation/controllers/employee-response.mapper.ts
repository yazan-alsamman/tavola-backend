import { EmployeeResult } from '../../application/dto/employee.result';
import { EmployeeResponseDto } from '../dto/employee.response.dto';

export function toEmployeeResponse(result: EmployeeResult): EmployeeResponseDto {
  return {
    employeeId: result.employeeId,
    restaurantId: result.restaurantId,
    roleId: result.roleId,
    userId: result.userId,
    firstName: result.firstName,
    lastName: result.lastName,
    email: result.email,
    phone: result.phone,
    status: result.status,
    assignedBranchIds: result.assignedBranchIds,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}
