import { Employee as PrismaEmployeeRow } from '@prisma/client';
import { Employee, EmployeeProps } from '../../domain/entities/employee.entity';
import { EmployeeStatus } from '../../domain/enums/authorization.enums';

export type EmployeeRow = PrismaEmployeeRow;

export class EmployeePrismaMapper {
  static toDomain(row: EmployeeRow, assignedBranchIds: string[]): Employee {
    if (!Object.values(EmployeeStatus).includes(row.status as EmployeeStatus)) {
      throw new Error(`Unknown employee status persisted: ${row.status}`);
    }

    const props: EmployeeProps = {
      id: row.id,
      restaurantId: row.restaurantId,
      roleId: row.roleId,
      userId: row.userId,
      permissionsVersion: row.permissionsVersion,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      status: row.status as EmployeeStatus,
      assignedBranchIds,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };

    return Employee.reconstitute(props);
  }

  static toPersistence(employee: Employee): EmployeeRow {
    const props = employee.toProps();
    return {
      id: props.id,
      restaurantId: props.restaurantId,
      roleId: props.roleId,
      userId: props.userId,
      permissionsVersion: props.permissionsVersion,
      firstName: props.firstName,
      lastName: props.lastName,
      email: props.email,
      phone: props.phone,
      status: props.status,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      deletedAt: props.deletedAt,
    };
  }
}
