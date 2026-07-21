import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { CreateFloorPlanUseCase } from '../../application/use-cases/create-floor-plan.use-case';
import { ListFloorPlansUseCase } from '../../application/use-cases/list-floor-plans.use-case';
import { ActivateFloorPlanUseCase } from '../../application/use-cases/activate-floor-plan.use-case';
import { ListTablesByFloorPlanUseCase } from '../../application/use-cases/list-tables-by-floor-plan.use-case';
import { FloorPlanResult } from '../../application/dto/floor-plan.result';
import { FloorPlanListResult } from '../../application/dto/floor-plan-list.result';
import { TableListResult } from '../../application/dto/table-list.result';
import { CreateFloorPlanRequestDto } from '../dto/create-floor-plan.request.dto';
import { ListTablesQueryDto } from '../dto/list-tables.query.dto';
import { FloorPlanResponseDto } from '../dto/floor-plan.response.dto';
import { FloorPlanListResponseDto } from '../dto/floor-plan-list.response.dto';
import { TableListResponseDto } from '../dto/table-list.response.dto';
import { toTableResponse } from './table-response.mapper';

/**
 * Nested under `/restaurants/:restaurantId/branches/:branchId` (TASKS.md
 * Phase 6.1 Routing decision: "Collection routes remain nested... Equivalent
 * routing for FloorPlans"). `FloorPlan` carries no direct `organizationId`
 * column (TENANCY.md), so every route resolves the parent Restaurant then
 * Branch through their already-tenant-scoped repositories first - see each
 * use case's own "tenant isolation gate" comment. Organization-administrative
 * only, identical authorization stack to `BranchesController`.
 */
@ApiTags('Floor Plans')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'restaurants/:restaurantId/branches/:branchId/floor-plans', version: '1' })
export class FloorPlansController {
  constructor(
    private readonly createFloorPlanUseCase: CreateFloorPlanUseCase,
    private readonly listFloorPlansUseCase: ListFloorPlansUseCase,
    private readonly activateFloorPlanUseCase: ActivateFloorPlanUseCase,
    private readonly listTablesByFloorPlanUseCase: ListTablesByFloorPlanUseCase,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Floor plan created successfully.')
  @ApiOperation({
    operationId: 'floorPlansCreate',
    summary: 'Create a floor plan under a branch',
    description:
      'The first FloorPlan created for a branch becomes active automatically (Aggregate Invariant, TASKS.md Phase 6.1 decision #5); every subsequent one starts inactive and must go through the activate endpoint.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Floor plan created', type: FloorPlanResponseDto })
  @ApiErrorResponse(400, 'Validation failure (invalid field format)', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(
    404,
    'Restaurant not found, or branch not found (or belongs to another restaurant)',
    ['NOT_FOUND'],
  )
  async create(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() body: CreateFloorPlanRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<FloorPlanResponseDto> {
    const result = await this.createFloorPlanUseCase.execute({
      actor,
      restaurantId,
      branchId,
      name: body.name,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toResponse(result);
  }

  @Get()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Floor plans retrieved successfully.')
  @ApiOperation({
    operationId: 'floorPlansList',
    summary: 'List floor plans of a branch',
    description:
      'Unpaginated - a branch’s FloorPlan count is small and bounded (one per physical/seasonal layout).',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Floor plans retrieved',
    type: FloorPlanListResponseDto,
  })
  @ApiErrorResponse(400, 'restaurantId or branchId is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found, or branch not found', ['NOT_FOUND'])
  async list(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<FloorPlanListResponseDto> {
    const result = await this.listFloorPlansUseCase.execute({ actor, restaurantId, branchId });
    return this.toListResponse(result);
  }

  @Patch(':floorPlanId/activate')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Floor plan activated successfully.')
  @ApiOperation({
    operationId: 'floorPlansActivate',
    summary: 'Activate a floor plan (deactivates the previously active one)',
    description:
      'Atomically deactivates the branch’s previously active FloorPlan in the same operation (Aggregate Invariant, TASKS.md Phase 6.1 decision #5) - at most one active FloorPlan per branch at all times.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiParam({ name: 'floorPlanId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Floor plan activated', type: FloorPlanResponseDto })
  @ApiErrorResponse(400, 'restaurantId, branchId, or floorPlanId is not a valid UUID', [
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(
    404,
    'Restaurant not found, branch not found, or floor plan not found (or belongs to another branch)',
    ['NOT_FOUND'],
  )
  async activate(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('floorPlanId', ParseUUIDPipe) floorPlanId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<FloorPlanResponseDto> {
    const result = await this.activateFloorPlanUseCase.execute({
      actor,
      restaurantId,
      branchId,
      floorPlanId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toResponse(result);
  }

  @Get(':floorPlanId/tables')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Tables retrieved successfully.')
  @ApiOperation({
    operationId: 'floorPlansListTables',
    summary: 'List tables belonging to one floor plan',
    description:
      'FloorPlan-scoped Table read capability (TASKS.md Phase 6.1 decision #4) - FloorPlan is the owner of the table layout.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiParam({ name: 'floorPlanId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Tables retrieved', type: TableListResponseDto })
  @ApiErrorResponse(400, 'Invalid page/limit or path parameters', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(
    404,
    'Restaurant not found, branch not found, or floor plan not found (or belongs to another branch)',
    ['NOT_FOUND'],
  )
  async listTables(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('floorPlanId', ParseUUIDPipe) floorPlanId: string,
    @Query() query: ListTablesQueryDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<TableListResponseDto> {
    const result = await this.listTablesByFloorPlanUseCase.execute({
      actor,
      restaurantId,
      branchId,
      floorPlanId,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return this.toTableListResponse(result);
  }

  private toResponse(result: FloorPlanResult): FloorPlanResponseDto {
    return {
      floorPlanId: result.floorPlanId,
      branchId: result.branchId,
      name: result.name,
      isActive: result.isActive,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  private toListResponse(result: FloorPlanListResult): FloorPlanListResponseDto {
    return { items: result.items.map((item) => this.toResponse(item)) };
  }

  private toTableListResponse(result: TableListResult): TableListResponseDto {
    return {
      items: result.items.map(toTableResponse),
      page: result.page,
      limit: result.limit,
      total: result.total,
    };
  }
}
