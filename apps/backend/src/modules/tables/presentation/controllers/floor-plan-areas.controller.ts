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
import { SkipResponseEnvelope } from '@common/decorators/skip-response-envelope.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { OrganizationMemberGuard } from '@modules/authorization/presentation/guards/organization-member.guard';
import { RequireOrgRole } from '@modules/authorization/presentation/decorators/require-org-role.decorator';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { CreateFloorPlanAreaUseCase } from '../../application/use-cases/create-floor-plan-area.use-case';
import { ListFloorPlanAreasUseCase } from '../../application/use-cases/list-floor-plan-areas.use-case';
import { GetFloorPlanAreaUseCase } from '../../application/use-cases/get-floor-plan-area.use-case';
import { UpdateFloorPlanAreaUseCase } from '../../application/use-cases/update-floor-plan-area.use-case';
import { DeleteFloorPlanAreaUseCase } from '../../application/use-cases/delete-floor-plan-area.use-case';
import { FloorPlanAreaResult } from '../../application/dto/floor-plan-area.result';
import { FloorPlanAreaListResult } from '../../application/dto/floor-plan-area-list.result';
import { CreateFloorPlanAreaRequestDto } from '../dto/create-floor-plan-area.request.dto';
import { UpdateFloorPlanAreaRequestDto } from '../dto/update-floor-plan-area.request.dto';
import { FloorPlanAreaResponseDto } from '../dto/floor-plan-area.response.dto';
import { FloorPlanAreaListResponseDto } from '../dto/floor-plan-area-list.response.dto';

const DEFAULT_SORT_ORDER = 0;

/**
 * ADR-040 - concurrent dining areas (halls) inside one FloorPlan.
 *
 * Nested under the full aggregate-ownership chain
 * (`/restaurants/:restaurantId/branches/:branchId/floor-plans/:floorPlanId`),
 * following API_GUIDELINES.md's collection-route rule and
 * `FloorPlansController`'s own precedent. Unlike `Table`, an Area gets NO flat
 * `/floor-plan-areas/:id` route: the guidelines' flat-route rule exists so a
 * resource is addressable once its id is known, and an Area is only ever
 * addressed from inside the editor that already holds its whole plan context -
 * a flat route would add a second tenant-resolution path to audit for no
 * caller.
 *
 * Organization-administrative only, with the identical authorization stack to
 * `FloorPlansController` (`JwtAuthGuard` + `SessionVersionGuard` +
 * `OrganizationMemberGuard`, Owner/Admin). Deliberately NOT the dual-actor
 * `assertActorCanManageTables` pattern used by Merge/Split: defining the halls
 * of a layout is floor-plan configuration, which is Owner/Admin territory in
 * this module, not a front-of-house operation an Employee performs during
 * service (ADR-040 decision #11).
 */
@ApiTags('Floor Plan Areas')
@ApiExtraModels(ErrorResponseDto)
@Controller({
  path: 'restaurants/:restaurantId/branches/:branchId/floor-plans/:floorPlanId/areas',
  version: '1',
})
export class FloorPlanAreasController {
  constructor(
    private readonly createFloorPlanAreaUseCase: CreateFloorPlanAreaUseCase,
    private readonly listFloorPlanAreasUseCase: ListFloorPlanAreasUseCase,
    private readonly getFloorPlanAreaUseCase: GetFloorPlanAreaUseCase,
    private readonly updateFloorPlanAreaUseCase: UpdateFloorPlanAreaUseCase,
    private readonly deleteFloorPlanAreaUseCase: DeleteFloorPlanAreaUseCase,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Floor plan area created successfully.')
  @ApiOperation({
    operationId: 'floorPlanAreasCreate',
    summary: 'Create a dining area (hall) inside a floor plan',
    description:
      'Areas of one floor plan are all live at the same time - this is not FloorPlan.isActive, which keeps meaning "at most one layout per branch is active" and is untouched by this endpoint. name must be unique among the non-deleted areas of the plan; color is exactly #RRGGBB and is stored uppercase.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiParam({ name: 'floorPlanId', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Area created', type: FloorPlanAreaResponseDto })
  @ApiErrorResponse(400, 'Validation failure (invalid field format, e.g. a malformed color)', [
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
  @ApiErrorResponse(409, 'name is already taken within this floor plan', ['CONFLICT'])
  async create(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('floorPlanId', ParseUUIDPipe) floorPlanId: string,
    @Body() body: CreateFloorPlanAreaRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<FloorPlanAreaResponseDto> {
    const result = await this.createFloorPlanAreaUseCase.execute({
      actor,
      restaurantId,
      branchId,
      floorPlanId,
      name: body.name,
      color: body.color,
      sortOrder: body.sortOrder ?? DEFAULT_SORT_ORDER,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toResponse(result);
  }

  @Get()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Floor plan areas retrieved successfully.')
  @ApiOperation({
    operationId: 'floorPlanAreasList',
    summary: 'List the dining areas of a floor plan',
    description:
      'Unpaginated, ordered by sortOrder ascending then createdAt ascending - the editor renders every tab of a layout at once. An empty list is a valid, fully configured plan: every table simply sits on the layout itself.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiParam({ name: 'floorPlanId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Areas retrieved', type: FloorPlanAreaListResponseDto })
  @ApiErrorResponse(400, 'A path parameter is not a valid UUID', ['VALIDATION_ERROR'])
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
  async list(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('floorPlanId', ParseUUIDPipe) floorPlanId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<FloorPlanAreaListResponseDto> {
    const result = await this.listFloorPlanAreasUseCase.execute({
      actor,
      restaurantId,
      branchId,
      floorPlanId,
    });
    return this.toListResponse(result);
  }

  @Get(':areaId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Floor plan area retrieved successfully.')
  @ApiOperation({
    operationId: 'floorPlanAreasGetById',
    summary: 'Get one dining area of a floor plan',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiParam({ name: 'floorPlanId', format: 'uuid' })
  @ApiParam({ name: 'areaId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Area retrieved', type: FloorPlanAreaResponseDto })
  @ApiErrorResponse(400, 'A path parameter is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(
    404,
    'Restaurant, branch, or floor plan not found, or area not found (or belongs to another floor plan)',
    ['NOT_FOUND'],
  )
  async getById(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('floorPlanId', ParseUUIDPipe) floorPlanId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<FloorPlanAreaResponseDto> {
    const result = await this.getFloorPlanAreaUseCase.execute({
      actor,
      restaurantId,
      branchId,
      floorPlanId,
      floorPlanAreaId: areaId,
    });
    return this.toResponse(result);
  }

  @Patch(':areaId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Floor plan area updated successfully.')
  @ApiOperation({
    operationId: 'floorPlanAreasUpdate',
    summary: 'Update a dining area (full replace of its own attributes)',
    description:
      'Full-replace semantics: every field is written, so omit nothing you want to keep. Never moves the area to another floor plan - the tables inside it are positioned relative to this one specific layout.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiParam({ name: 'floorPlanId', format: 'uuid' })
  @ApiParam({ name: 'areaId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Area updated', type: FloorPlanAreaResponseDto })
  @ApiErrorResponse(400, 'Validation failure (invalid field format, e.g. a malformed color)', [
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(
    404,
    'Restaurant, branch, or floor plan not found, or area not found (or belongs to another floor plan)',
    ['NOT_FOUND'],
  )
  @ApiErrorResponse(409, 'name is already taken within this floor plan', ['CONFLICT'])
  async update(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('floorPlanId', ParseUUIDPipe) floorPlanId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Body() body: UpdateFloorPlanAreaRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<FloorPlanAreaResponseDto> {
    const result = await this.updateFloorPlanAreaUseCase.execute({
      actor,
      restaurantId,
      branchId,
      floorPlanId,
      floorPlanAreaId: areaId,
      name: body.name,
      color: body.color,
      sortOrder: body.sortOrder ?? DEFAULT_SORT_ORDER,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toResponse(result);
  }

  @Delete(':areaId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({
    operationId: 'floorPlanAreasDelete',
    summary: 'Soft-delete a dining area',
    description:
      'Rejected with 409 while any non-deleted table is still assigned to the area - tables are never silently reassigned or orphaned. Reassign or delete them first. Deleting releases the area name for reuse within the plan.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiParam({ name: 'floorPlanId', format: 'uuid' })
  @ApiParam({ name: 'areaId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Area deleted' })
  @ApiErrorResponse(400, 'A path parameter is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(
    404,
    'Restaurant, branch, or floor plan not found, or area not found (or belongs to another floor plan)',
    ['NOT_FOUND'],
  )
  @ApiErrorResponse(409, 'Tables are still assigned to this area', ['CONFLICT'])
  async delete(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('floorPlanId', ParseUUIDPipe) floorPlanId: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.deleteFloorPlanAreaUseCase.execute({
      actor,
      restaurantId,
      branchId,
      floorPlanId,
      floorPlanAreaId: areaId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  private toResponse(result: FloorPlanAreaResult): FloorPlanAreaResponseDto {
    return {
      floorPlanAreaId: result.floorPlanAreaId,
      floorPlanId: result.floorPlanId,
      name: result.name,
      color: result.color,
      sortOrder: result.sortOrder,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  private toListResponse(result: FloorPlanAreaListResult): FloorPlanAreaListResponseDto {
    return { items: result.items.map((item) => this.toResponse(item)) };
  }
}
