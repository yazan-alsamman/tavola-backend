import { Module } from '@nestjs/common';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { BranchesModule } from '@modules/branches/branches.module';
import { InviteEmployeeUseCase } from './application/use-cases/invite-employee.use-case';
import { AssignEmployeeRoleUseCase } from './application/use-cases/assign-employee-role.use-case';
import { AssignEmployeeToBranchUseCase } from './application/use-cases/assign-employee-branch.use-case';
import { RemoveEmployeeFromBranchUseCase } from './application/use-cases/remove-employee-branch.use-case';
import { RemoveEmployeeUseCase } from './application/use-cases/remove-employee.use-case';
import { EmployeesController } from './presentation/controllers/employees.controller';

/**
 * Phase 7.0 (Employee Management) - `Employee`/`Role`/`RolePermission` domain
 * entities and their Prisma repositories were already built in Phase 2
 * (Authorization); this module owns only the use cases, controller, and DTOs
 * that manage the Employee lifecycle (Invite/Assign Role/Assign Branch/Remove
 * from Branch/Remove), reusing `EMPLOYEE_REPOSITORY`/`ROLE_REPOSITORY` from
 * `AuthorizationModule` rather than re-declaring the repositories here - the
 * same cross-module reuse pattern `BranchesModule` uses for
 * `RESTAURANT_REPOSITORY`. Depends on `RestaurantsModule` for
 * `RESTAURANT_REPOSITORY` (tenant validation - Employee carries no direct
 * `organizationId`, TENANCY.md) and `BranchesModule` for `BRANCH_REPOSITORY`
 * (branch-assignment validation). Authorization is `OrganizationMemberGuard` +
 * `@RequireOrgRole(Owner, Admin)` only - deliberately, not the seeded
 * `Restaurant Manager` role's `employees:manage` permission (TASKS.md Phase
 * 7.0 decision note item 2). No migration: all backing tables already exist
 * from Phase 2.1.
 */
@Module({
  imports: [AuthenticationModule, AuthorizationModule, RestaurantsModule, BranchesModule],
  controllers: [EmployeesController],
  providers: [
    InviteEmployeeUseCase,
    AssignEmployeeRoleUseCase,
    AssignEmployeeToBranchUseCase,
    RemoveEmployeeFromBranchUseCase,
    RemoveEmployeeUseCase,
  ],
})
export class EmployeesModule {}
