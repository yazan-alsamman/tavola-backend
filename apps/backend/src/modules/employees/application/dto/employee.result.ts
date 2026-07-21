import { EmployeeStatus } from '@modules/authorization/domain/enums/authorization.enums';

export interface EmployeeResult {
  employeeId: string;
  restaurantId: string;
  roleId: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: EmployeeStatus;
  assignedBranchIds: string[];
  createdAt: Date;
  updatedAt: Date;
}
