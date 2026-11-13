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
import { CreateBranchUseCase } from '../../application/use-cases/create-branch.use-case';
import { GetBranchUseCase } from '../../application/use-cases/get-branch.use-case';
import { ListBranchesUseCase } from '../../application/use-cases/list-branches.use-case';
import { UpdateBranchUseCase } from '../../application/use-cases/update-branch.use-case';
import { DeleteBranchUseCase } from '../../application/use-cases/delete-branch.use-case';
import { GetBranchWorkingHoursUseCase } from '../../application/use-cases/get-branch-working-hours.use-case';
import { UpdateBranchWorkingHoursUseCase } from '../../application/use-cases/update-branch-working-hours.use-case';
import { BranchResult } from '../../application/dto/branch.result';
import { BranchListResult } from '../../application/dto/branch-list.result';
import { BranchWorkingHoursResult } from '../../application/dto/branch-working-hours.result';
import { CreateBranchRequestDto } from '../dto/create-branch.request.dto';
import { UpdateBranchRequestDto } from '../dto/update-branch.request.dto';
import { ListBranchesQueryDto } from '../dto/list-branches.query.dto';
import { UpdateBranchWorkingHoursRequestDto } from '../dto/update-branch-working-hours.request.dto';
import { BranchResponseDto } from '../dto/branch.response.dto';
import { BranchListResponseDto } from '../dto/branch-list.response.dto';
import { BranchWorkingHoursResponseDto } from '../dto/branch-working-hours.response.dto';
import { BranchSettingsResponseDto } from '../dto/branch-settings.response.dto';
import { UpdateBranchSettingsRequestDto } from '../dto/update-branch-settings.request.dto';
import { GetBranchSettingsUseCase } from '../../application/use-cases/get-branch-settings.use-case';
import { UpdateBranchSettingsUseCase } from '../../application/use-cases/update-branch-settings.use-case';
import { BranchSettingsResult } from '../../application/dto/branch-settings.result';
import { GetBranchCategoriesUseCase } from '../../application/use-cases/get-branch-categories.use-case';
import { SetBranchCategoriesUseCase } from '../../application/use-cases/set-branch-categories.use-case';
import { UpdateBranchDetailsUseCase } from '../../application/use-cases/update-branch-details.use-case';
import { BranchCategoriesResult } from '../../application/dto/branch-categories.result';
import { BranchCategoriesResponseDto } from '../dto/branch-categories.response.dto';
import { SetBranchCategoriesRequestDto } from '../dto/set-branch-categories.request.dto';
import { UpdateBranchDetailsRequestDto } from '../dto/update-branch-details.request.dto';

/**
 * Nested under `/restaurants/:restaurantId` (not a flat top-level `/branches`
 * resource) - matches the existing precedent set by Restaurant Gallery's own
 * two-level nesting (`/restaurants/:id/gallery/:galleryItemId`, Phase 4.4)
 * and API_GUIDELINES.md's own nesting example. `Branch` carries no direct
 * `organizationId` column (TENANCY.md), so every route resolves the parent
 * Restaurant through the already-tenant-scoped `RestaurantRepository` first -
 * see each use case's own "tenant isolation gate" comment. Organization-
 * administrative only, identical authorization stack to `RestaurantsController`
 * (Phase 4.1 scope decision): `OrganizationMemberGuard` + `@RequireOrgRole(Owner,
 * Admin)`, never `PermissionsGuard`/`@RequirePermission` on the same route.
 */
@ApiTags('Branches')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'restaurants/:restaurantId/branches', version: '1' })
export class BranchesController {
  constructor(
    private readonly createBranchUseCase: CreateBranchUseCase,
    private readonly getBranchUseCase: GetBranchUseCase,
    private readonly listBranchesUseCase: ListBranchesUseCase,
    private readonly updateBranchUseCase: UpdateBranchUseCase,
    private readonly deleteBranchUseCase: DeleteBranchUseCase,
    private readonly getBranchWorkingHoursUseCase: GetBranchWorkingHoursUseCase,
    private readonly updateBranchWorkingHoursUseCase: UpdateBranchWorkingHoursUseCase,
    private readonly getBranchSettingsUseCase: GetBranchSettingsUseCase,
    private readonly updateBranchSettingsUseCase: UpdateBranchSettingsUseCase,
    private readonly getBranchCategoriesUseCase: GetBranchCategoriesUseCase,
    private readonly setBranchCategoriesUseCase: SetBranchCategoriesUseCase,
    private readonly updateBranchDetailsUseCase: UpdateBranchDetailsUseCase,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Branch created successfully.')
  @ApiOperation({
    operationId: 'branchesCreate',
    summary: 'Create a branch under a restaurant',
    description:
      'Requires an OrganizationMember actor holding Owner or Admin role. The restaurant must belong to the caller organization - tenant scoping is automatic (TENANCY.md) via the parent Restaurant lookup. latitude/longitude must both be set or both omitted (ADR-018); working hours (see :branchId/working-hours) and Maps/Address integration are deferred to later Branch sub-phases.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Branch created', type: BranchResponseDto })
  @ApiErrorResponse(400, 'Validation failure (invalid field format)', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found (or belongs to another organization)', ['NOT_FOUND'])
  async create(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Body() body: CreateBranchRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<BranchResponseDto> {
    const result = await this.createBranchUseCase.execute({
      actor,
      restaurantId,
      city: body.city,
      district: body.district ?? null,
      address: body.address,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      countryCode: body.countryCode,
      currency: body.currency ?? null,
      timezone: body.timezone,
      phone: body.phone ?? null,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toResponse(result);
  }

  @Get(':branchId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branch retrieved successfully.')
  @ApiOperation({
    operationId: 'branchesGetById',
    summary: 'Get a branch by id',
    description:
      'Only branches belonging to the caller organization are ever visible - tenant scoping is automatic (TENANCY.md), not expressed in this URL.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Branch retrieved', type: BranchResponseDto })
  @ApiErrorResponse(400, 'restaurantId or branchId is not a valid UUID', ['VALIDATION_ERROR'])
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
  async getById(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<BranchResponseDto> {
    const result = await this.getBranchUseCase.execute({ actor, restaurantId, branchId });
    return this.toResponse(result);
  }

  @Get()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branches retrieved successfully.')
  @ApiOperation({
    operationId: 'branchesList',
    summary: 'List branches of a restaurant',
    description:
      "Paginated, ordered most-recently-created first. Only the caller organization's own restaurant's branches - tenant scoping is automatic (TENANCY.md).",
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Branches retrieved', type: BranchListResponseDto })
  @ApiErrorResponse(400, 'Invalid page/limit or restaurantId', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found (or belongs to another organization)', ['NOT_FOUND'])
  async list(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Query() query: ListBranchesQueryDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<BranchListResponseDto> {
    const result = await this.listBranchesUseCase.execute({
      actor,
      restaurantId,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return this.toListResponse(result);
  }

  @Patch(':branchId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branch updated successfully.')
  @ApiOperation({
    operationId: 'branchesUpdate',
    summary: 'Update a branch (full-replace)',
    description:
      'Full-replace update of city/district/address/countryCode/currency/timezone/phone. Never accepts restaurantId - see UpdateBranchRequestDto.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Branch updated', type: BranchResponseDto })
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
  async update(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() body: UpdateBranchRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<BranchResponseDto> {
    const result = await this.updateBranchUseCase.execute({
      actor,
      restaurantId,
      branchId,
      city: body.city,
      district: body.district ?? null,
      address: body.address,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      countryCode: body.countryCode,
      currency: body.currency ?? null,
      timezone: body.timezone,
      phone: body.phone ?? null,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toResponse(result);
  }

  @Delete(':branchId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({
    operationId: 'branchesDelete',
    summary: 'Soft-delete a branch',
    description:
      'Soft delete (API_GUIDELINES.md "DELETE: soft delete unless otherwise specified") - sets deletedAt, never removes the row. Not idempotent: deleting an already-deleted (or nonexistent) branch returns 404. The DOMAIN_MODEL.md rule restricting deletion when the branch has future Pending/Approved reservations is not enforced yet - the Reservation aggregate does not exist until Phase 7.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Branch deleted' })
  @ApiErrorResponse(400, 'restaurantId or branchId is not a valid UUID', ['VALIDATION_ERROR'])
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
  async delete(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.deleteBranchUseCase.execute({
      actor,
      restaurantId,
      branchId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Get(':branchId/working-hours')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branch working hours retrieved successfully.')
  @ApiOperation({
    operationId: 'branchesGetWorkingHours',
    summary: 'Get a branch weekly working hours override',
    description:
      'Branch-level override (Phase 5.2) - a separate child entity from the Restaurant-level default (Phase 4.3). Only branches belonging to the caller organization are ever visible - tenant scoping is automatic (TENANCY.md). A day absent from `entries` has no override configured; a brand-new branch has an empty `entries` array until explicitly configured.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Branch working hours retrieved',
    type: BranchWorkingHoursResponseDto,
  })
  @ApiErrorResponse(400, 'restaurantId or branchId is not a valid UUID', ['VALIDATION_ERROR'])
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
  async getWorkingHours(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<BranchWorkingHoursResponseDto> {
    const result = await this.getBranchWorkingHoursUseCase.execute({
      actor,
      restaurantId,
      branchId,
    });
    return this.toWorkingHoursResponse(result);
  }

  @Patch(':branchId/working-hours')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branch working hours updated successfully.')
  @ApiOperation({
    operationId: 'branchesUpdateWorkingHours',
    summary: 'Replace a branch weekly working hours override (full-replace)',
    description:
      "Full-replace of the entire week: the submitted `entries` become the branch's complete override - a day omitted from `entries` has no override for that branch. Only branches belonging to the caller organization can be updated - tenant scoping is automatic (TENANCY.md).",
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Branch working hours updated',
    type: BranchWorkingHoursResponseDto,
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
  @ApiErrorResponse(
    404,
    'Restaurant not found, or branch not found (or belongs to another restaurant)',
    ['NOT_FOUND'],
  )
  async updateWorkingHours(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() body: UpdateBranchWorkingHoursRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<BranchWorkingHoursResponseDto> {
    const result = await this.updateBranchWorkingHoursUseCase.execute({
      actor,
      restaurantId,
      branchId,
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

  private toResponse(result: BranchResult): BranchResponseDto {
    return {
      branchId: result.branchId,
      restaurantId: result.restaurantId,
      city: result.city,
      district: result.district,
      address: result.address,
      latitude: result.latitude,
      longitude: result.longitude,
      countryCode: result.countryCode,
      currency: result.currency,
      name: result.name,
      description: result.description,
      coverImageId: result.coverImageId,
      referencePrice: result.referencePrice,
      priceLevel: result.priceLevel,
      timezone: result.timezone,
      phone: result.phone,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  private toListResponse(result: BranchListResult): BranchListResponseDto {
    return {
      items: result.items.map((item) => this.toResponse(item)),
      page: result.page,
      limit: result.limit,
      total: result.total,
    };
  }

  @Get(':branchId/settings')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branch settings retrieved successfully.')
  @ApiOperation({
    operationId: 'branchesGetSettings',
    summary: 'Get a branch reservation rules',
    description:
      'ADR-051: each branch has its own reservation rules. A branch that never saved its own returns its restaurant settings.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Branch settings', type: BranchSettingsResponseDto })
  @ApiErrorResponse(400, 'restaurantId or branchId is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant or branch not found', ['NOT_FOUND'])
  async getSettings(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<BranchSettingsResponseDto> {
    const result = await this.getBranchSettingsUseCase.execute({ actor, restaurantId, branchId });
    return this.toSettingsResponse(result);
  }

  @Patch(':branchId/settings')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branch settings updated successfully.')
  @ApiOperation({
    operationId: 'branchesUpdateSettings',
    summary: 'Replace a branch reservation rules',
    description: 'ADR-051: full replace of this branch rules; other branches are unchanged.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Branch settings', type: BranchSettingsResponseDto })
  @ApiErrorResponse(400, 'Invalid body or ids', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant or branch not found', ['NOT_FOUND'])
  async updateSettings(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() body: UpdateBranchSettingsRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<BranchSettingsResponseDto> {
    const result = await this.updateBranchSettingsUseCase.execute({
      actor,
      restaurantId,
      branchId,
      ...body,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toSettingsResponse(result);
  }

  @Patch(':branchId/details')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branch details updated successfully.')
  @ApiOperation({
    operationId: 'branchesUpdateDetails',
    summary: 'Set a branch name and description',
    description:
      'ADR-051: full replace of the branch name and description. Null or empty falls back to the restaurant value. The branch cover is uploaded with POST /restaurants/{id}/cover-image and branchId.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Branch updated', type: BranchResponseDto })
  @ApiErrorResponse(400, 'Invalid body or ids', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant or branch not found', ['NOT_FOUND'])
  async updateDetails(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() body: UpdateBranchDetailsRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<BranchResponseDto> {
    const result = await this.updateBranchDetailsUseCase.execute({
      actor,
      restaurantId,
      branchId,
      name: body.name,
      description: body.description,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toResponse(result);
  }

  @Get(':branchId/categories')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branch categories retrieved successfully.')
  @ApiOperation({
    operationId: 'branchesGetCategories',
    summary: 'Get a branch cuisine and occasion categories',
    description: 'ADR-051: each branch has its own cuisine and occasion categories.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Branch categories', type: BranchCategoriesResponseDto })
  @ApiErrorResponse(400, 'restaurantId or branchId is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant or branch not found', ['NOT_FOUND'])
  async getCategories(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<BranchCategoriesResponseDto> {
    const result = await this.getBranchCategoriesUseCase.execute({ actor, restaurantId, branchId });
    return this.toCategoriesResponse(result);
  }

  @Patch(':branchId/categories')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branch categories updated successfully.')
  @ApiOperation({
    operationId: 'branchesSetCategories',
    summary: 'Replace a branch cuisine and occasion categories',
    description:
      'ADR-051: full replace of both lists for this branch. The restaurant-level categories (GET /restaurants/{id}/cuisine-categories) become the union over its live branches, which Discovery filters use.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Branch categories', type: BranchCategoriesResponseDto })
  @ApiErrorResponse(400, 'Invalid body, ids, or an unknown or inactive category', [
    'VALIDATION_ERROR',
    'UNKNOWN_CUISINE_CATEGORY',
    'UNKNOWN_OCCASION_CATEGORY',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant or branch not found', ['NOT_FOUND'])
  async setCategories(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() body: SetBranchCategoriesRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<BranchCategoriesResponseDto> {
    const result = await this.setBranchCategoriesUseCase.execute({
      actor,
      restaurantId,
      branchId,
      cuisineCategoryIds: body.cuisineCategoryIds,
      occasionCategoryIds: body.occasionCategoryIds,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return this.toCategoriesResponse(result);
  }

  private toCategoriesResponse(result: BranchCategoriesResult): BranchCategoriesResponseDto {
    return {
      branchId: result.branchId,
      cuisineCategories: result.cuisineCategories.map((category) => ({
        ...category,
        createdAt: category.createdAt.toISOString(),
        updatedAt: category.updatedAt.toISOString(),
      })),
      occasionCategories: result.occasionCategories.map((category) => ({
        ...category,
        createdAt: category.createdAt.toISOString(),
        updatedAt: category.updatedAt.toISOString(),
      })),
    };
  }

  private toSettingsResponse(result: BranchSettingsResult): BranchSettingsResponseDto {
    return { ...result, updatedAt: result.updatedAt.toISOString() };
  }

  private toWorkingHoursResponse(result: BranchWorkingHoursResult): BranchWorkingHoursResponseDto {
    return {
      branchId: result.branchId,
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
