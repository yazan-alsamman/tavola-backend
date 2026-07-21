import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { SkipResponseEnvelope } from '@common/decorators/skip-response-envelope.decorator';
import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { OrganizationMemberGuard } from '@modules/authorization/presentation/guards/organization-member.guard';
import { RequireOrgRole } from '@modules/authorization/presentation/decorators/require-org-role.decorator';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { TableShape } from '../../domain/enums/table.enums';
import { GetTableUseCase } from '../../application/use-cases/get-table.use-case';
import { UpdateTableUseCase } from '../../application/use-cases/update-table.use-case';
import { DeleteTableUseCase } from '../../application/use-cases/delete-table.use-case';
import { MoveTableUseCase } from '../../application/use-cases/move-table.use-case';
import { ChangeTableStatusUseCase } from '../../application/use-cases/change-table-status.use-case';
import { UpdateTableRequestDto } from '../dto/update-table.request.dto';
import { MoveTableRequestDto } from '../dto/move-table.request.dto';
import { ChangeTableStatusRequestDto } from '../dto/change-table-status.request.dto';
import { TableResponseDto } from '../dto/table.response.dto';
import { toTableResponse } from './table-response.mapper';

/**
 * Flat individual resource (`/tables/:tableId`, TASKS.md Phase 6.1 Routing
 * decision: "Individual resources remain flat") - no `restaurantId`/
 * `branchId` in the URL. Tenant scoping is still automatic: every use case
 * walks the relation chain upward from the Table row (Table -> Branch ->
 * Restaurant) rather than trusting a URL-supplied identifier - see
 * `GetTableUseCase`'s own comment. Organization-administrative only,
 * identical authorization stack to `BranchesController`.
 */
@ApiTags('Tables')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'tables', version: '1' })
export class TableController {
  constructor(
    private readonly getTableUseCase: GetTableUseCase,
    private readonly updateTableUseCase: UpdateTableUseCase,
    private readonly deleteTableUseCase: DeleteTableUseCase,
    private readonly moveTableUseCase: MoveTableUseCase,
    private readonly changeTableStatusUseCase: ChangeTableStatusUseCase,
  ) {}

  @Get(':tableId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Table retrieved successfully.')
  @ApiOperation({
    operationId: 'tablesGetById',
    summary: 'Get a table by id',
    description:
      'Only tables belonging to the caller organization are ever visible - tenant scoping is automatic (TENANCY.md), not expressed in this URL.',
  })
  @ApiParam({ name: 'tableId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Table retrieved', type: TableResponseDto })
  @ApiErrorResponse(400, 'tableId is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Table not found (or belongs to another organization)', ['NOT_FOUND'])
  async getById(
    @Param('tableId', ParseUUIDPipe) tableId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<TableResponseDto> {
    const result = await this.getTableUseCase.execute({ actor, tableId });
    return toTableResponse(result);
  }

  @Patch(':tableId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Table updated successfully.')
  @ApiOperation({
    operationId: 'tablesUpdate',
    summary: 'Update a table (full-replace)',
    description:
      'Full-replace update of profile fields. Never accepts floorPlanId (see POST /tables/:tableId/move, a dedicated Domain Action, Phase 6.2) or status (see POST /tables/:tableId/status, a dedicated Domain Action, Status Management architecture decision). tableNumber must remain unique within the branch.',
  })
  @ApiParam({ name: 'tableId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Table updated', type: TableResponseDto })
  @ApiErrorResponse(400, 'Validation failure (invalid field format)', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Table not found (or belongs to another organization)', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'tableNumber is already taken within this branch', ['CONFLICT'])
  async update(
    @Param('tableId', ParseUUIDPipe) tableId: string,
    @Body() body: UpdateTableRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<TableResponseDto> {
    const result = await this.updateTableUseCase.execute({
      actor,
      tableId,
      tableNumber: body.tableNumber,
      capacity: body.capacity,
      floor: body.floor ?? null,
      positionX: body.positionX ?? null,
      positionY: body.positionY ?? null,
      width: body.width ?? null,
      height: body.height ?? null,
      rotation: body.rotation ?? null,
      shape: body.shape ?? TableShape.Rectangle,
      layer: body.layer ?? null,
      indoor: body.indoor ?? true,
      vip: body.vip ?? false,
      smoking: body.smoking ?? false,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toTableResponse(result);
  }

  @Delete(':tableId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({
    operationId: 'tablesDelete',
    summary: 'Soft-delete a table',
    description:
      'Soft delete (API_GUIDELINES.md "DELETE: soft delete unless otherwise specified") - sets deletedAt, never removes the row. Not idempotent: deleting an already-deleted (or nonexistent) table returns 404.',
  })
  @ApiParam({ name: 'tableId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Table deleted' })
  @ApiErrorResponse(400, 'tableId is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Table not found (or belongs to another organization)', ['NOT_FOUND'])
  async delete(
    @Param('tableId', ParseUUIDPipe) tableId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.deleteTableUseCase.execute({
      actor,
      tableId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Post(':tableId/move')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Table moved successfully.')
  @ApiOperation({
    operationId: 'tablesMove',
    summary: 'Move a table to a different floor plan (Domain Action)',
    description:
      'Phase 6.2 architecture decision: a dedicated Domain Action, not a partial update - changes ONLY floorPlanId, nothing else. The target FloorPlan must exist, belong to this table’s own branch, and not be soft-deleted; cross-branch and cross-restaurant moves are rejected. No reservation, bounds, or collision validation is performed. Produces a table.moved audit-log entry only - no domain event is published.',
  })
  @ApiParam({ name: 'tableId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Table moved', type: TableResponseDto })
  @ApiErrorResponse(400, 'tableId or targetFloorPlanId is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Table not found (or belongs to another organization)', ['NOT_FOUND'])
  @ApiErrorResponse(
    404,
    'Target floor plan not found, belongs to a different branch, or is soft-deleted',
    ['NOT_FOUND'],
  )
  async move(
    @Param('tableId', ParseUUIDPipe) tableId: string,
    @Body() body: MoveTableRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<TableResponseDto> {
    const result = await this.moveTableUseCase.execute({
      actor,
      tableId,
      targetFloorPlanId: body.targetFloorPlanId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toTableResponse(result);
  }

  @Post(':tableId/status')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Table status changed successfully.')
  @ApiOperation({
    operationId: 'tablesChangeStatus',
    summary: 'Change a table status (Domain Action)',
    description:
      'Status Management architecture decision: the single dedicated Domain Action for every status transition - there are no separate disable/enable endpoints. Only Available <-> Occupied, Available <-> Cleaning, and Available <-> Disabled transitions are allowed; every other combination, including a same-status "transition", is rejected as an invalid transition. Reserved is not part of this enum (exclusively a Reservation Engine concept, deferred until that architecture is approved and frozen). Produces a table.status_changed audit-log entry only - no domain event is published.',
  })
  @ApiParam({ name: 'tableId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Table status changed', type: TableResponseDto })
  @ApiErrorResponse(400, 'tableId or status is not valid, or the transition is not allowed', [
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Table not found (or belongs to another organization)', ['NOT_FOUND'])
  async changeStatus(
    @Param('tableId', ParseUUIDPipe) tableId: string,
    @Body() body: ChangeTableStatusRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<TableResponseDto> {
    const result = await this.changeTableStatusUseCase.execute({
      actor,
      tableId,
      status: body.status,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toTableResponse(result);
  }
}
