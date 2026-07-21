import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { TableShape } from '../../domain/enums/table.enums';
import { CreateTableUseCase } from '../../application/use-cases/create-table.use-case';
import { ListTablesByBranchUseCase } from '../../application/use-cases/list-tables-by-branch.use-case';
import { TableListResult } from '../../application/dto/table-list.result';
import { CreateTableRequestDto } from '../dto/create-table.request.dto';
import { ListTablesQueryDto } from '../dto/list-tables.query.dto';
import { TableResponseDto } from '../dto/table.response.dto';
import { TableListResponseDto } from '../dto/table-list.response.dto';
import { toTableResponse } from './table-response.mapper';

/**
 * Nested under `/restaurants/:restaurantId/branches/:branchId` (TASKS.md
 * Phase 6.1 Routing decision: "Collection routes remain nested"). Individual
 * Table resources are flat (`TableController`, `/tables/:tableId`) - see
 * that controller's own comment.
 */
@ApiTags('Tables')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'restaurants/:restaurantId/branches/:branchId/tables', version: '1' })
export class TablesController {
  constructor(
    private readonly createTableUseCase: CreateTableUseCase,
    private readonly listTablesByBranchUseCase: ListTablesByBranchUseCase,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Table created successfully.')
  @ApiOperation({
    operationId: 'tablesCreate',
    summary: 'Create a table under a branch',
    description:
      'Always created with status Available (Phase 6.1 architecture decision) - no request field controls status. tableNumber must be unique within the branch. floorPlanId must reference a floor plan already belonging to this branch.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Table created', type: TableResponseDto })
  @ApiErrorResponse(400, 'Validation failure (invalid field format)', ['VALIDATION_ERROR'])
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
  @ApiErrorResponse(409, 'tableNumber is already taken within this branch', ['CONFLICT'])
  async create(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() body: CreateTableRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<TableResponseDto> {
    const result = await this.createTableUseCase.execute({
      actor,
      restaurantId,
      branchId,
      floorPlanId: body.floorPlanId,
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

  @Get()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Tables retrieved successfully.')
  @ApiOperation({
    operationId: 'tablesListByBranch',
    summary: 'List tables of a branch',
    description: 'Paginated, ordered most-recently-created first.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Tables retrieved', type: TableListResponseDto })
  @ApiErrorResponse(400, 'Invalid page/limit or path parameters', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found, or branch not found', ['NOT_FOUND'])
  async list(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListTablesQueryDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<TableListResponseDto> {
    const result = await this.listTablesByBranchUseCase.execute({
      actor,
      restaurantId,
      branchId,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return this.toListResponse(result);
  }

  private toListResponse(result: TableListResult): TableListResponseDto {
    return {
      items: result.items.map(toTableResponse),
      page: result.page,
      limit: result.limit,
      total: result.total,
    };
  }
}
