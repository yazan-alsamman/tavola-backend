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
import { SkipResponseEnvelope } from '@common/decorators/skip-response-envelope.decorator';
import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { OrganizationMemberGuard } from '@modules/authorization/presentation/guards/organization-member.guard';
import { RequireOrgRole } from '@modules/authorization/presentation/decorators/require-org-role.decorator';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { CreateRestaurantUseCase } from '../../application/use-cases/create-restaurant.use-case';
import { GetRestaurantUseCase } from '../../application/use-cases/get-restaurant.use-case';
import { ListRestaurantsUseCase } from '../../application/use-cases/list-restaurants.use-case';
import { UpdateRestaurantUseCase } from '../../application/use-cases/update-restaurant.use-case';
import { DeleteRestaurantUseCase } from '../../application/use-cases/delete-restaurant.use-case';
import { GetRestaurantSettingsUseCase } from '../../application/use-cases/get-restaurant-settings.use-case';
import { UpdateRestaurantSettingsUseCase } from '../../application/use-cases/update-restaurant-settings.use-case';
import { GetWorkingHoursUseCase } from '../../application/use-cases/get-working-hours.use-case';
import { UpdateWorkingHoursUseCase } from '../../application/use-cases/update-working-hours.use-case';
import { RestaurantResult } from '../../application/dto/restaurant.result';
import { RestaurantListResult } from '../../application/dto/restaurant-list.result';
import { RestaurantSettingsResult } from '../../application/dto/restaurant-settings.result';
import { WorkingHoursResult } from '../../application/dto/working-hours.result';
import { CreateRestaurantRequestDto } from '../dto/create-restaurant.request.dto';
import { UpdateRestaurantRequestDto } from '../dto/update-restaurant.request.dto';
import { UpdateRestaurantSettingsRequestDto } from '../dto/update-restaurant-settings.request.dto';
import { UpdateWorkingHoursRequestDto } from '../dto/update-working-hours.request.dto';
import { ListRestaurantsQueryDto } from '../dto/list-restaurants.query.dto';
import { RestaurantResponseDto } from '../dto/restaurant.response.dto';
import { RestaurantListResponseDto } from '../dto/restaurant-list.response.dto';
import { RestaurantSettingsResponseDto } from '../dto/restaurant-settings.response.dto';
import { WorkingHoursResponseDto } from '../dto/working-hours.response.dto';

/**
 * Organization-administrative only (Phase 4.1 scope decision, disclosed in
 * TASKS.md): every route requires `OrganizationMemberGuard` +
 * `@RequireOrgRole(Owner, Admin)`, never `PermissionsGuard`/`@RequirePermission`
 * - the two authorization layers are never combined on one route
 * (AUTHORIZATION_ARCHITECTURE.md §2.1/§14). Employee-driven restaurant
 * management (`restaurants:manage`, already seeded) is deferred to whichever
 * future phase actually implements Employee invitation/management - it has
 * no assigned phase today and building it now would be speculative,
 * untestable authorization surface.
 */
@ApiTags('Restaurants')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'restaurants', version: '1' })
export class RestaurantsController {
  constructor(
    private readonly createRestaurantUseCase: CreateRestaurantUseCase,
    private readonly getRestaurantUseCase: GetRestaurantUseCase,
    private readonly listRestaurantsUseCase: ListRestaurantsUseCase,
    private readonly updateRestaurantUseCase: UpdateRestaurantUseCase,
    private readonly deleteRestaurantUseCase: DeleteRestaurantUseCase,
    private readonly getRestaurantSettingsUseCase: GetRestaurantSettingsUseCase,
    private readonly updateRestaurantSettingsUseCase: UpdateRestaurantSettingsUseCase,
    private readonly getWorkingHoursUseCase: GetWorkingHoursUseCase,
    private readonly updateWorkingHoursUseCase: UpdateWorkingHoursUseCase,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Restaurant created successfully.')
  @ApiOperation({
    operationId: 'restaurantsCreate',
    summary: 'Create a restaurant within the caller organization',
    description:
      'Requires an OrganizationMember actor holding Owner or Admin role (organization-administrative authorization, not Employee RBAC). `organizationId` always comes from the JWT, never the request body. The slug is derived from the name when omitted.',
  })
  @ApiResponse({ status: 201, description: 'Restaurant created', type: RestaurantResponseDto })
  @ApiErrorResponse(400, 'Validation failure (invalid field format)', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(409, 'Slug already taken', ['CONFLICT'])
  async create(
    @Body() body: CreateRestaurantRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<RestaurantResponseDto> {
    const result = await this.createRestaurantUseCase.execute({
      actor,
      name: body.name,
      slug: body.slug,
      description: body.description ?? null,
      cuisineType: body.cuisineType ?? null,
      priceLevel: body.priceLevel ?? null,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toResponse(result);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurant retrieved successfully.')
  @ApiOperation({
    operationId: 'restaurantsGetById',
    summary: 'Get a restaurant by id',
    description:
      'Only restaurants belonging to the caller organization are ever visible - tenant scoping is automatic (TENANCY.md), not expressed in this URL.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Restaurant retrieved', type: RestaurantResponseDto })
  @ApiErrorResponse(400, 'id is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found (or belongs to another organization)', ['NOT_FOUND'])
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<RestaurantResponseDto> {
    const result = await this.getRestaurantUseCase.execute({ actor, restaurantId: id });
    return this.toResponse(result);
  }

  @Get()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurants retrieved successfully.')
  @ApiOperation({
    operationId: 'restaurantsList',
    summary: 'List restaurants in the caller organization',
    description:
      "Paginated, ordered most-recently-created first. Only the caller organization's own restaurants - tenant scoping is automatic (TENANCY.md).",
  })
  @ApiResponse({
    status: 200,
    description: 'Restaurants retrieved',
    type: RestaurantListResponseDto,
  })
  @ApiErrorResponse(400, 'Invalid page/limit', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  async list(
    @Query() query: ListRestaurantsQueryDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<RestaurantListResponseDto> {
    const result = await this.listRestaurantsUseCase.execute({
      actor,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return this.toListResponse(result);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurant updated successfully.')
  @ApiOperation({
    operationId: 'restaurantsUpdate',
    summary: 'Update a restaurant (full-replace)',
    description:
      'Full-replace update of name/description/cuisineType/priceLevel/status. Never accepts organizationId, slug, or averageRating - see UpdateRestaurantRequestDto.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Restaurant updated', type: RestaurantResponseDto })
  @ApiErrorResponse(400, 'Validation failure (invalid field format)', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found (or belongs to another organization)', ['NOT_FOUND'])
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRestaurantRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<RestaurantResponseDto> {
    const result = await this.updateRestaurantUseCase.execute({
      actor,
      restaurantId: id,
      name: body.name,
      description: body.description ?? null,
      cuisineType: body.cuisineType ?? null,
      priceLevel: body.priceLevel ?? null,
      status: body.status,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toResponse(result);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({
    operationId: 'restaurantsDelete',
    summary: 'Soft-delete a restaurant',
    description:
      'Soft delete (API_GUIDELINES.md "DELETE: soft delete unless otherwise specified") - sets deletedAt, never removes the row. Not idempotent: deleting an already-deleted (or nonexistent) restaurant returns 404, matching GET/PATCH behavior for the same id.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Restaurant deleted' })
  @ApiErrorResponse(400, 'id is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found (or belongs to another organization)', ['NOT_FOUND'])
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.deleteRestaurantUseCase.execute({
      actor,
      restaurantId: id,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Get(':id/settings')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurant settings retrieved successfully.')
  @ApiOperation({
    operationId: 'restaurantsGetSettings',
    summary: 'Get a restaurant reservation settings',
    description:
      'Only restaurants belonging to the caller organization are ever visible - tenant scoping is automatic (TENANCY.md), not expressed in this URL. Settings are auto-created with defaults when the restaurant is created.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Restaurant settings retrieved',
    type: RestaurantSettingsResponseDto,
  })
  @ApiErrorResponse(400, 'id is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found (or belongs to another organization)', ['NOT_FOUND'])
  async getSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<RestaurantSettingsResponseDto> {
    const result = await this.getRestaurantSettingsUseCase.execute({
      actor,
      restaurantId: id,
    });
    return this.toSettingsResponse(result);
  }

  @Patch(':id/settings')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurant settings updated successfully.')
  @ApiOperation({
    operationId: 'restaurantsUpdateSettings',
    summary: 'Update a restaurant reservation settings (full-replace)',
    description:
      'Full-replace update of every settings field - see UpdateRestaurantSettingsRequestDto for bounds. Only restaurants belonging to the caller organization can be updated - tenant scoping is automatic (TENANCY.md).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Restaurant settings updated',
    type: RestaurantSettingsResponseDto,
  })
  @ApiErrorResponse(400, 'Validation failure (invalid field format or out-of-bounds value)', [
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found (or belongs to another organization)', ['NOT_FOUND'])
  async updateSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRestaurantSettingsRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<RestaurantSettingsResponseDto> {
    const result = await this.updateRestaurantSettingsUseCase.execute({
      actor,
      restaurantId: id,
      reservationIntervalMinutes: body.reservationIntervalMinutes,
      maxGuestsPerReservation: body.maxGuestsPerReservation,
      cancellationWindowMinutes: body.cancellationWindowMinutes,
      pendingReservationTimeoutMinutes: body.pendingReservationTimeoutMinutes,
      autoApproval: body.autoApproval,
      timezone: body.timezone,
      defaultCurrency: body.defaultCurrency ?? null,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toSettingsResponse(result);
  }

  @Get(':id/working-hours')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurant working hours retrieved successfully.')
  @ApiOperation({
    operationId: 'restaurantsGetWorkingHours',
    summary: 'Get a restaurant weekly working hours',
    description:
      'Restaurant-level default only (Phase 4.3 scope; branch-level override is a future phase). Only restaurants belonging to the caller organization are ever visible - tenant scoping is automatic (TENANCY.md). A day absent from `entries` is closed that day; a brand-new restaurant has an empty `entries` array until explicitly configured.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Restaurant working hours retrieved',
    type: WorkingHoursResponseDto,
  })
  @ApiErrorResponse(400, 'id is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found (or belongs to another organization)', ['NOT_FOUND'])
  async getWorkingHours(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<WorkingHoursResponseDto> {
    const result = await this.getWorkingHoursUseCase.execute({
      actor,
      restaurantId: id,
    });
    return this.toWorkingHoursResponse(result);
  }

  @Patch(':id/working-hours')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurant working hours updated successfully.')
  @ApiOperation({
    operationId: 'restaurantsUpdateWorkingHours',
    summary: 'Replace a restaurant weekly working hours (full-replace)',
    description:
      "Full-replace of the entire week: the submitted `entries` become the restaurant's complete schedule - a day omitted from `entries` becomes closed that day. Restaurant-level only (Phase 4.3 scope; branch-level override is a future phase). Only restaurants belonging to the caller organization can be updated - tenant scoping is automatic (TENANCY.md).",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Restaurant working hours updated',
    type: WorkingHoursResponseDto,
  })
  @ApiErrorResponse(
    400,
    'Validation failure (invalid field format, out-of-bounds value, or duplicate dayOfWeek)',
    ['VALIDATION_ERROR'],
  )
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found (or belongs to another organization)', ['NOT_FOUND'])
  async updateWorkingHours(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateWorkingHoursRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<WorkingHoursResponseDto> {
    const result = await this.updateWorkingHoursUseCase.execute({
      actor,
      restaurantId: id,
      entries: body.entries.map((entry) => ({
        dayOfWeek: entry.dayOfWeek,
        openingTime: entry.openingTime,
        closingTime: entry.closingTime,
        breakStartTime: entry.breakStartTime ?? null,
        breakEndTime: entry.breakEndTime ?? null,
      })),
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toWorkingHoursResponse(result);
  }

  private toResponse(result: RestaurantResult): RestaurantResponseDto {
    return {
      restaurantId: result.restaurantId,
      name: result.name,
      slug: result.slug,
      logoId: result.logoId,
      coverImageId: result.coverImageId,
      description: result.description,
      cuisineType: result.cuisineType,
      averageRating: result.averageRating,
      priceLevel: result.priceLevel,
      status: result.status,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  private toListResponse(result: RestaurantListResult): RestaurantListResponseDto {
    return {
      items: result.items.map((item) => this.toResponse(item)),
      page: result.page,
      limit: result.limit,
      total: result.total,
    };
  }

  private toSettingsResponse(result: RestaurantSettingsResult): RestaurantSettingsResponseDto {
    return {
      restaurantId: result.restaurantId,
      reservationIntervalMinutes: result.reservationIntervalMinutes,
      maxGuestsPerReservation: result.maxGuestsPerReservation,
      cancellationWindowMinutes: result.cancellationWindowMinutes,
      pendingReservationTimeoutMinutes: result.pendingReservationTimeoutMinutes,
      autoApproval: result.autoApproval,
      timezone: result.timezone,
      defaultCurrency: result.defaultCurrency,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  private toWorkingHoursResponse(result: WorkingHoursResult): WorkingHoursResponseDto {
    return {
      restaurantId: result.restaurantId,
      entries: result.entries.map((entry) => ({
        dayOfWeek: entry.dayOfWeek,
        openingTime: entry.openingTime,
        closingTime: entry.closingTime,
        breakStartTime: entry.breakStartTime,
        breakEndTime: entry.breakEndTime,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      })),
    };
  }
}
