import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiExtraModels, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { ListRestaurantsQueryDto } from '@modules/restaurants/presentation/dto/list-restaurants.query.dto';
import { RestaurantResponseDto } from '@modules/restaurants/presentation/dto/restaurant.response.dto';
import { RestaurantListResponseDto } from '@modules/restaurants/presentation/dto/restaurant-list.response.dto';
import { ListBranchesQueryDto } from '@modules/branches/presentation/dto/list-branches.query.dto';
import { BranchResponseDto } from '@modules/branches/presentation/dto/branch.response.dto';
import { BranchListResponseDto } from '@modules/branches/presentation/dto/branch-list.response.dto';
import { toTableResponse } from '@modules/tables/presentation/controllers/table-response.mapper';
import { ListDiscoverableRestaurantsUseCase } from '../../application/use-cases/list-discoverable-restaurants.use-case';
import { GetDiscoverableRestaurantUseCase } from '../../application/use-cases/get-discoverable-restaurant.use-case';
import { ListDiscoverableBranchesUseCase } from '../../application/use-cases/list-discoverable-branches.use-case';
import { GetDiscoverableBranchUseCase } from '../../application/use-cases/get-discoverable-branch.use-case';
import { GetDiscoverableFloorPlanUseCase } from '../../application/use-cases/get-discoverable-floor-plan.use-case';
import { FloorPlanWithTablesResponseDto } from '../dto/floor-plan-with-tables.response.dto';
import {
  toDiscoveryBranchResponse,
  toDiscoveryFloorPlanResponse,
  toDiscoveryRestaurantResponse,
} from './discovery-response.mapper';

/**
 * Customer Restaurant Discovery & Public Read Surface (owner-authorized,
 * this session). Every route is public/unauthenticated - no `JwtAuthGuard`,
 * no tenant/organization scope - matching ADR-018 §4 ("Search/nearby
 * endpoints are public with rate limiting") and the existing
 * `TaxonomyCategoriesController`/public Review-listing precedent. This is
 * NOT ADR-018's future Phase 15.5 Discovery module (no search, filter,
 * nearby/geo query, ranking, or comparison logic lives here) - it is the
 * minimal "customer can browse a restaurant, its branches, and its active
 * floor plan/table topology" capability, reusing the same Result/Response
 * DTO shapes the Owner/Admin management endpoints already return (those
 * shapes never carried an internal/administrative field to begin with -
 * see `DiscoveryReaderPort`'s own doc comment). Table-level time/party-size
 * availability remains `GET /reservations/availability`'s own sole
 * authority (ADR-013) - not duplicated here.
 */
@ApiTags('Discovery')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'discovery/restaurants', version: '1' })
export class DiscoveryController {
  constructor(
    private readonly listDiscoverableRestaurantsUseCase: ListDiscoverableRestaurantsUseCase,
    private readonly getDiscoverableRestaurantUseCase: GetDiscoverableRestaurantUseCase,
    private readonly listDiscoverableBranchesUseCase: ListDiscoverableBranchesUseCase,
    private readonly getDiscoverableBranchUseCase: GetDiscoverableBranchUseCase,
    private readonly getDiscoverableFloorPlanUseCase: GetDiscoverableFloorPlanUseCase,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurants retrieved successfully.')
  @ApiOperation({
    operationId: 'discoveryListRestaurants',
    summary: 'Browse restaurants (public, unauthenticated)',
    description:
      'Paginated, ordered most-recently-created first. Only `Active`, non-soft-deleted restaurants across every organization - discovery intentionally crosses tenant boundaries (this is the product purpose), never leaking `organizationId` or any other tenant-internal field.',
  })
  @ApiResponse({
    status: 200,
    description: 'Restaurants retrieved',
    type: RestaurantListResponseDto,
  })
  @ApiErrorResponse(400, 'Invalid page/limit', ['VALIDATION_ERROR'])
  async listRestaurants(
    @Query() query: ListRestaurantsQueryDto,
  ): Promise<RestaurantListResponseDto> {
    const result = await this.listDiscoverableRestaurantsUseCase.execute({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return {
      items: result.items.map(toDiscoveryRestaurantResponse),
      page: result.page,
      limit: result.limit,
      total: result.total,
    };
  }

  @Get(':restaurantId')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurant retrieved successfully.')
  @ApiOperation({
    operationId: 'discoveryGetRestaurant',
    summary: 'Get a restaurant by id (public, unauthenticated)',
    description: 'Unknown, soft-deleted, or non-Active (e.g. Suspended) restaurants 404.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Restaurant retrieved', type: RestaurantResponseDto })
  @ApiErrorResponse(400, 'restaurantId is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(404, 'Restaurant not found', ['NOT_FOUND'])
  async getRestaurant(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
  ): Promise<RestaurantResponseDto> {
    const result = await this.getDiscoverableRestaurantUseCase.execute({ restaurantId });
    return toDiscoveryRestaurantResponse(result);
  }

  @Get(':restaurantId/branches')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branches retrieved successfully.')
  @ApiOperation({
    operationId: 'discoveryListBranches',
    summary: 'Browse branches of a restaurant (public, unauthenticated)',
    description: 'Paginated, ordered most-recently-created first.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Branches retrieved', type: BranchListResponseDto })
  @ApiErrorResponse(400, 'Invalid page/limit or restaurantId', ['VALIDATION_ERROR'])
  @ApiErrorResponse(404, 'Restaurant not found', ['NOT_FOUND'])
  async listBranches(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Query() query: ListBranchesQueryDto,
  ): Promise<BranchListResponseDto> {
    const result = await this.listDiscoverableBranchesUseCase.execute({
      restaurantId,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return {
      items: result.items.map(toDiscoveryBranchResponse),
      page: result.page,
      limit: result.limit,
      total: result.total,
    };
  }

  @Get(':restaurantId/branches/:branchId')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branch retrieved successfully.')
  @ApiOperation({
    operationId: 'discoveryGetBranch',
    summary: 'Get a branch by id (public, unauthenticated)',
    description: 'A branch belonging to a different restaurant, or unknown/soft-deleted, 404s.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Branch retrieved', type: BranchResponseDto })
  @ApiErrorResponse(400, 'restaurantId or branchId is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(
    404,
    'Restaurant not found, or branch not found (or belongs to another restaurant)',
    ['NOT_FOUND'],
  )
  async getBranch(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ): Promise<BranchResponseDto> {
    const result = await this.getDiscoverableBranchUseCase.execute({ restaurantId, branchId });
    return toDiscoveryBranchResponse(result);
  }

  @Get(':restaurantId/branches/:branchId/floor-plan')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Floor plan retrieved successfully.')
  @ApiOperation({
    operationId: 'discoveryGetActiveFloorPlan',
    summary: "Get a branch's active floor plan and table topology (public, unauthenticated)",
    description:
      "Returns the branch's single active FloorPlan together with every non-soft-deleted Table on it (position, dimensions, shape, capacity, status, merge-group fields) - the seating-chart data a Customer reservation UX renders. Returns 404 if the branch has no active FloorPlan configured yet. Table-level time/party-size availability is a separate call (GET /reservations/availability, ADR-013) - never duplicated here.",
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Floor plan and table topology retrieved',
    type: FloorPlanWithTablesResponseDto,
  })
  @ApiErrorResponse(400, 'restaurantId or branchId is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(
    404,
    'Restaurant not found, branch not found, or branch has no active floor plan',
    ['NOT_FOUND'],
  )
  async getActiveFloorPlan(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ): Promise<FloorPlanWithTablesResponseDto> {
    const result = await this.getDiscoverableFloorPlanUseCase.execute({
      restaurantId,
      branchId,
    });
    return {
      floorPlan: toDiscoveryFloorPlanResponse(result.floorPlan),
      tables: result.tables.map(toTableResponse),
    };
  }
}
