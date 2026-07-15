import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { EmployeeId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { Employee } from '../../domain/entities/employee.entity';
import { EmployeeStatus } from '../../domain/enums/authorization.enums';
import {
  EmployeeAuthContext,
  EmployeeRepository,
} from '../../domain/repositories/authorization.repositories';
import { EmployeePrismaMapper } from './employee.prisma-mapper';

@Injectable()
export class PrismaEmployeeRepository implements EmployeeRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findById(id: EmployeeId): Promise<Employee | null> {
    const row = await this.prismaContext.client.employee.findUnique({
      where: { id: id.value },
      include: { branchAssignments: { select: { branchId: true } } },
    });

    if (!row) {
      return null;
    }

    return EmployeePrismaMapper.toDomain(
      row,
      row.branchAssignments.map((assignment) => assignment.branchId),
    );
  }

  /**
   * Runs during Login/Refresh, filtered only by the caller's own verified
   * `userId` (never by `organizationId`), so it cannot leak another tenant's
   * data - the same justification as `PrismaLoginOrganizationReader`. Unlike
   * that reader, this query's top-level model is `Employee`, which is not in
   * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`, so the ordinary
   * tenant-scoped `PrismaContext` client is a safe no-op passthrough here
   * even with no TenantContext bound yet - no raw `PrismaService` exception
   * needed. The nested `restaurant`/`branchAssignments` includes are part of
   * this same single query, not separate top-level operations, so they are
   * unaffected by `Restaurant` being a directly tenant-scoped model.
   */
  async findActiveAuthContextByUserId(userId: UserId): Promise<EmployeeAuthContext | null> {
    const row = await this.prismaContext.client.employee.findFirst({
      where: {
        userId: userId.value,
        status: EmployeeStatus.Active,
        deletedAt: null,
      },
      include: {
        restaurant: { select: { organizationId: true } },
        branchAssignments: { select: { branchId: true } },
      },
    });

    if (!row) {
      return null;
    }

    const employee = EmployeePrismaMapper.toDomain(
      row,
      row.branchAssignments.map((assignment) => assignment.branchId),
    );

    return { employee, organizationId: row.restaurant.organizationId };
  }

  async save(employee: Employee): Promise<void> {
    const data = EmployeePrismaMapper.toPersistence(employee);
    await this.prismaContext.client.employee.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        restaurantId: data.restaurantId,
        roleId: data.roleId,
        userId: data.userId,
        permissionsVersion: data.permissionsVersion,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        status: data.status,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        deletedAt: data.deletedAt,
      },
      update: {
        roleId: data.roleId,
        userId: data.userId,
        permissionsVersion: data.permissionsVersion,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        status: data.status,
        updatedAt: data.updatedAt,
        deletedAt: data.deletedAt,
      },
    });
  }
}
