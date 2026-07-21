import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { OrganizationMemberGuard } from '@modules/authorization/presentation/guards/organization-member.guard';
import { RequireOrgRole } from '@modules/authorization/presentation/decorators/require-org-role.decorator';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { InviteEmployeeUseCase } from '../../application/use-cases/invite-employee.use-case';
import { AssignEmployeeRoleUseCase } from '../../application/use-cases/assign-employee-role.use-case';
import { AssignEmployeeToBranchUseCase } from '../../application/use-cases/assign-employee-branch.use-case';
import { RemoveEmployeeFromBranchUseCase } from '../../application/use-cases/remove-employee-branch.use-case';
import { RemoveEmployeeUseCase } from '../../application/use-cases/remove-employee.use-case';
import { InviteEmployeeRequestDto } from '../dto/invite-employee.request.dto';
import { AssignEmployeeRoleRequestDto } from '../dto/assign-employee-role.request.dto';
import { AssignEmployeeBranchRequestDto } from '../dto/assign-employee-branch.request.dto';
import { EmployeeResponseDto } from '../dto/employee.response.dto';
import { toEmployeeResponse } from './employee-response.mapper';

/**
 * Phase 7.0 (Employee Management) - nested under `restaurants/:restaurantId`
 * (Employee carries a direct `restaurantId` column, one hop from Restaurant,
 * matching `BranchesController`'s own nested convention, not Table's later
 * flat one). Authorization is `OrganizationMemberGuard` +
 * `@RequireOrgRole(Owner, Admin)` for every route - deliberately, not the
 * seeded `Restaurant Manager` role's `employees:manage` permission (TASKS.md
 * Phase 7.0 decision note item 2: bootstrap necessity + no multi-actor-type
 * "OR" guard composition exists yet).
 */
@ApiTags('Employees')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'restaurants/:restaurantId/employees', version: '1' })
export class EmployeesController {
  constructor(
    private readonly inviteEmployeeUseCase: InviteEmployeeUseCase,
    private readonly assignEmployeeRoleUseCase: AssignEmployeeRoleUseCase,
    private readonly assignEmployeeToBranchUseCase: AssignEmployeeToBranchUseCase,
    private readonly removeEmployeeFromBranchUseCase: RemoveEmployeeFromBranchUseCase,
    private readonly removeEmployeeUseCase: RemoveEmployeeUseCase,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Employee invited successfully.')
  @ApiOperation({
    operationId: 'employeesInvite',
    summary: 'Invite a new employee (Domain Action)',
    description:
      'Creates an Employee row with status Invited and no linked User - linking happens exclusively at first login (AUTHENTICATION_ARCHITECTURE.md §1.2). Email uniqueness is scoped per-restaurant, not global.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Employee invited', type: EmployeeResponseDto })
  @ApiErrorResponse(400, 'Validation failure (invalid field format)', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant or Role not found', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'An employee with this email already exists at this restaurant', [
    'CONFLICT',
  ])
  async invite(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Body() body: InviteEmployeeRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<EmployeeResponseDto> {
    const result = await this.inviteEmployeeUseCase.execute({
      actor,
      restaurantId,
      roleId: body.roleId,
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone ?? null,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toEmployeeResponse(result);
  }

  @Post(':employeeId/role')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Employee role assigned successfully.')
  @ApiOperation({
    operationId: 'employeesAssignRole',
    summary: 'Assign a role to an employee (Domain Action)',
    description:
      'Changes only roleId; bumps permissionsVersion (AUTHORIZATION_ARCHITECTURE.md §17).',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'employeeId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Role assigned', type: EmployeeResponseDto })
  @ApiErrorResponse(400, 'employeeId, restaurantId, or roleId is not a valid UUID', [
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Employee or Role not found (or belongs to another organization)', [
    'NOT_FOUND',
  ])
  async assignRole(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() body: AssignEmployeeRoleRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<EmployeeResponseDto> {
    const result = await this.assignEmployeeRoleUseCase.execute({
      actor,
      restaurantId,
      employeeId,
      roleId: body.roleId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toEmployeeResponse(result);
  }

  @Post(':employeeId/branches')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Employee assigned to branch successfully.')
  @ApiOperation({
    operationId: 'employeesAssignBranch',
    summary: 'Assign an employee to a branch (Domain Action)',
    description:
      'Idempotent - an already-assigned branch is a no-op. The target branch must belong to the same restaurant as the employee.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'employeeId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Employee assigned to branch',
    type: EmployeeResponseDto,
  })
  @ApiErrorResponse(400, 'employeeId, restaurantId, or branchId is not a valid UUID', [
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(
    404,
    'Employee or Branch not found, or Branch belongs to a different restaurant',
    ['NOT_FOUND'],
  )
  async assignBranch(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() body: AssignEmployeeBranchRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<EmployeeResponseDto> {
    const result = await this.assignEmployeeToBranchUseCase.execute({
      actor,
      restaurantId,
      employeeId,
      branchId: body.branchId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toEmployeeResponse(result);
  }

  @Delete(':employeeId/branches/:branchId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Employee removed from branch successfully.')
  @ApiOperation({
    operationId: 'employeesRemoveBranch',
    summary: 'Remove an employee from a branch (Domain Action)',
    description:
      'Idempotent - a branch that is not currently assigned is a no-op. Removing the last explicit assignment restores restaurant-wide scope.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'employeeId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Employee removed from branch',
    type: EmployeeResponseDto,
  })
  @ApiErrorResponse(400, 'employeeId, restaurantId, or branchId is not a valid UUID', [
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Employee not found (or belongs to another organization)', ['NOT_FOUND'])
  async removeBranch(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<EmployeeResponseDto> {
    const result = await this.removeEmployeeFromBranchUseCase.execute({
      actor,
      restaurantId,
      employeeId,
      branchId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toEmployeeResponse(result);
  }

  @Delete(':employeeId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Employee removed successfully.')
  @ApiOperation({
    operationId: 'employeesRemove',
    summary: 'Soft-delete an employee',
    description:
      'Soft delete (API_GUIDELINES.md "DELETE: soft delete unless otherwise specified") - sets deletedAt, never removes the row, and never flips EmployeeStatus (TASKS.md Phase 7.0 decision note item 1). Rejected if this employee is the restaurant\'s last Manager-role employee.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'employeeId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Employee removed', type: EmployeeResponseDto })
  @ApiErrorResponse(400, 'employeeId or restaurantId is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Employee not found (or belongs to another organization)', ['NOT_FOUND'])
  @ApiErrorResponse(409, "Employee is the restaurant's last Manager-role employee", ['CONFLICT'])
  async remove(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<EmployeeResponseDto> {
    const result = await this.removeEmployeeUseCase.execute({
      actor,
      restaurantId,
      employeeId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toEmployeeResponse(result);
  }
}
