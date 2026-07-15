import { Inject, Injectable } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import {
  EmployeeAccessResolverPort,
  EmployeeAccessSnapshot,
} from '@modules/authentication/application/ports/employee-access-resolver.port';
import {
  EmployeeRepository,
  RolePermissionRepository,
} from '../../domain/repositories/authorization.repositories';
import { PermissionResolver } from '../../domain/services/permission-resolver';
import { EMPLOYEE_REPOSITORY, ROLE_PERMISSION_REPOSITORY } from '../tokens/authorization.tokens';

/**
 * Application-layer orchestrator named `RbacPermissionResolver` in
 * AUTHORIZATION_ARCHITECTURE.md §1.3's target module layout: loads the raw
 * grant/revocation rows for an Employee and hands them to the framework-free
 * domain `PermissionResolver` to compute the effective permission set, then
 * shapes the result for JWT embedding. Implements Authentication's
 * `EmployeeAccessResolverPort` so Login/Refresh can depend on the port
 * without importing this module's internals.
 */
@Injectable()
export class RbacPermissionResolver implements EmployeeAccessResolverPort {
  constructor(
    @Inject(EMPLOYEE_REPOSITORY) private readonly employeeRepository: EmployeeRepository,
    @Inject(ROLE_PERMISSION_REPOSITORY)
    private readonly rolePermissionRepository: RolePermissionRepository,
  ) {}

  async resolveForUserId(userId: UserId): Promise<EmployeeAccessSnapshot | null> {
    const context = await this.employeeRepository.findActiveAuthContextByUserId(userId);
    if (context === null) {
      return null;
    }

    const { employee, organizationId } = context;

    const grantRecords = await this.rolePermissionRepository.findGrantRecordsForEmployee(
      employee.roleId,
      employee.employeeId,
    );
    const effectivePermissions = PermissionResolver.resolveFromRecords(grantRecords);

    return {
      employeeId: employee.employeeId.value,
      organizationId,
      restaurantId: employee.restaurantId.value,
      branchIds: employee.hasRestaurantWideScope() ? [] : employee.toProps().assignedBranchIds,
      permissions: Array.from(effectivePermissions),
      permissionsVersion: employee.permissionsVersion,
    };
  }
}
