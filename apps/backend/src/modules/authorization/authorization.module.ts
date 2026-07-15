import { Module } from '@nestjs/common';
import { EMPLOYEE_ACCESS_RESOLVER } from '@modules/authentication/application/ports/employee-access-resolver.port';
import { RbacPermissionResolver } from './application/resolvers/rbac-permission-resolver';
import {
  EMPLOYEE_REPOSITORY,
  ROLE_PERMISSION_REPOSITORY,
} from './application/tokens/authorization.tokens';
import { PrismaEmployeeRepository } from './infrastructure/persistence/prisma-employee.repository';
import { PrismaRolePermissionRepository } from './infrastructure/persistence/prisma-role-permission.repository';
import { PermissionsGuard } from './presentation/guards/permissions.guard';
import { OrganizationMemberGuard } from './presentation/guards/organization-member.guard';

@Module({
  providers: [
    PrismaEmployeeRepository,
    PrismaRolePermissionRepository,
    RbacPermissionResolver,
    PermissionsGuard,
    OrganizationMemberGuard,
    { provide: EMPLOYEE_REPOSITORY, useExisting: PrismaEmployeeRepository },
    { provide: ROLE_PERMISSION_REPOSITORY, useExisting: PrismaRolePermissionRepository },
    { provide: EMPLOYEE_ACCESS_RESOLVER, useExisting: RbacPermissionResolver },
  ],
  exports: [
    EMPLOYEE_ACCESS_RESOLVER,
    EMPLOYEE_REPOSITORY,
    ROLE_PERMISSION_REPOSITORY,
    PermissionsGuard,
    OrganizationMemberGuard,
  ],
})
export class AuthorizationModule {}
