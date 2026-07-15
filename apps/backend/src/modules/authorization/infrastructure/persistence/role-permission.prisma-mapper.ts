import {
  RolePermission as PrismaRolePermissionRow,
  RolePermissionType as PrismaRolePermissionType,
} from '@prisma/client';
import { RolePermission, RolePermissionProps } from '../../domain/entities/role-permission.entity';
import { RolePermissionType } from '../../domain/enums/authorization.enums';

export class RolePermissionPrismaMapper {
  static toDomain(row: PrismaRolePermissionRow): RolePermission {
    const props: RolePermissionProps = {
      id: row.id,
      roleId: row.roleId,
      employeeId: row.employeeId,
      permissionId: row.permissionId,
      type: row.type as RolePermissionType,
      createdAt: row.createdAt,
    };

    return RolePermission.reconstitute(props);
  }

  static toPersistence(rolePermission: RolePermission): PrismaRolePermissionRow {
    const props = rolePermission.toProps();
    return {
      id: props.id,
      roleId: props.roleId,
      employeeId: props.employeeId,
      permissionId: props.permissionId,
      type: props.type as unknown as PrismaRolePermissionType,
      createdAt: props.createdAt,
    };
  }
}
