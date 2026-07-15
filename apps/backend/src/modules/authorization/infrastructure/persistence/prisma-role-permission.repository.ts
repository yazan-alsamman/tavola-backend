import { Injectable } from '@nestjs/common';
import { RolePermissionType as PrismaRolePermissionType } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { EmployeeId, RoleId } from '@shared/domain/value-objects/identifiers.vo';
import { RolePermission } from '../../domain/entities/role-permission.entity';
import { RolePermissionType } from '../../domain/enums/authorization.enums';
import { RolePermissionRepository } from '../../domain/repositories/authorization.repositories';
import { PermissionGrantRecord } from '../../domain/services/permission-resolver';
import { RolePermissionPrismaMapper } from './role-permission.prisma-mapper';

@Injectable()
export class PrismaRolePermissionRepository implements RolePermissionRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findByRoleId(roleId: RoleId): Promise<RolePermission[]> {
    const rows = await this.prismaContext.client.rolePermission.findMany({
      where: { roleId: roleId.value },
    });
    return rows.map((row) => RolePermissionPrismaMapper.toDomain(row));
  }

  async findByEmployeeId(employeeId: EmployeeId): Promise<RolePermission[]> {
    const rows = await this.prismaContext.client.rolePermission.findMany({
      where: { employeeId: employeeId.value },
    });
    return rows.map((row) => RolePermissionPrismaMapper.toDomain(row));
  }

  async save(rolePermission: RolePermission): Promise<void> {
    const data = RolePermissionPrismaMapper.toPersistence(rolePermission);
    await this.prismaContext.client.rolePermission.upsert({
      where: { id: data.id },
      create: data,
      update: { type: data.type },
    });
  }

  /**
   * Role-level grants come from `role_permissions` rows for the employee's
   * role (`type = RoleGrant`); individual overrides come from rows scoped to
   * the employee directly (`employeeId`), regardless of grant/revocation -
   * `PermissionResolver` decides precedence, this method only assembles the
   * raw inputs in one round trip.
   */
  async findGrantRecordsForEmployee(
    roleId: RoleId,
    employeeId: EmployeeId,
  ): Promise<PermissionGrantRecord[]> {
    const rows = await this.prismaContext.client.rolePermission.findMany({
      where: {
        OR: [
          { roleId: roleId.value, type: PrismaRolePermissionType.RoleGrant },
          { employeeId: employeeId.value },
        ],
      },
      include: { permission: { select: { slug: true } } },
    });

    return rows.map((row) => ({
      slug: row.permission.slug,
      type: row.type as unknown as RolePermissionType,
    }));
  }
}
