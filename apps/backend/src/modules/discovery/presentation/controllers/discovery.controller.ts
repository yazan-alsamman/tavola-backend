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
  UseGuards,
} from '@nestjs/common';
import { ApiExtraModels, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { ListBranchesQueryDto } from '@modules/branches/presentation/dto/list-branches.query.dto';
import { BranchResponseDto } from '@modules/branches/presentation/dto/branch.response.dto';
import { BranchListResponseDto } from '@modules/branches/presentation/dto/branch-list.response.dto';
import { ListOffersQueryDto } from '@modules/offers/presentation/dto/list-offers.query.dto';
import { OfferListResponseDto } from '@modules/offers/presentation/dto/offer-list.response.dto';
import { toOfferListResponse } from '@modules/offers/presentation/controllers/offer-response.mapper';
import { RestaurantResponseDto } from '@modules/restaurants/presentation/dto/restaurant.response.dto';
import { ListDiscoverableRestaurantsUseCase } from '../../application/use-cases/list-discoverable-restaurants.use-case';
import { GetDiscoverableRestaurantUseCase } from '../../application/use-cases/get-discoverable-restaurant.use-case';
import { ListDiscoverableBranchesUseCase } from '../../application/use-cases/list-discoverable-branches.use-case';
import { GetDiscoverableBranchUseCase } from '../../application/use-cases/get-discoverable-branch.use-case';
import { GetDiscoverableFloorPlanUseCase } from '../../application/use-cases/get-discoverable-floor-plan.use-case';
import { ListDiscoverableOffersUseCase } from '../../application/use-cases/list-discoverable-offers.use-case';
import { NearbyRestaurantsUseCase } from '../../application/use-cases/nearby-restaurants.use-case';
import { CompareRestaurantsUseCase } from '../../application/use-cases/compare-restaurants.use-case';
import { FloorPlanWithTablesResponseDto } from '../dto/floor-plan-with-tables.response.dto';
import { SearchRestaurantsQueryDto } from '../dto/search-restaurants.query.dto';
import { NearbyRestaurantsQueryDto } from '../dto/nearby-restaurants.query.dto';
import { CompareRestaurantsRequestDto } from '../dto/compare-restaurants.request.dto';
import { DiscoverableRestaurantListResponseDto } from '../dto/discoverable-restaurant-list.response.dto';
import { NearbyRestaurantListResponseDto } from '../dto/nearby-restaurant-list.response.dto';
import { CompareRestaurantsResponseDto } from '../dto/compare-restaurants.response.dto';
import { DiscoveryRateLimitGuard } from '../guards/discovery-rate-limit.guard';
import {
  toDiscoverableRestaurantResponse,
  toDiscoveryBranchResponse,
  toDiscoveryRestaurantResponse,
  toFloorPlanPublicResponse,
  toNearbyRestaurantResponse,
  toTablePublicResponse,
} from './discovery-response.mapper';

/**
 * Customer Restaurant Discovery & Public Read Surface, extended by Phase 15.5
 * (Discovery Module, architecture frozen 2026-07-29). Every route remains
 * public/unauthenticated - no `JwtAuthGuard`, no tenant/organization scope -
 * matching ADR-018 §4 ("Search/nearby endpoints are public with rate
 * limiting"). Phase 15.5 adds `DiscoveryRateLimitGuard` to every route (D12,
 * closing a pre-existing gap on the 2026-07-28 browsing routes too), extends
 * `GET /` with optional search/filter/sort params (D5-D7), adds
 * `GET /nearby` and `POST /compare` (D2-D4/D15), and corrects the
 * `.../floor-plan` route's response to a dedicated customer-safe projection
 * (D11) - see `TASKS.md`'s Phase 15.5 decision note for the full record.
 *
 * Route-ordering note (D-adjacent implementation detail, not an owner
 * decision): `GET nearby` MUST be declared before `GET :restaurantId` below,
 * or NestJS/Express would match the literal segment `nearby` as a
 * `:restaurantId` path value (failing its `ParseUUIDPipe`) - `POST compare`
 * carries no such constraint since it is a distinct HTTP verb from the
 * existing `:restaurantId` GET route.
 */
@ApiTags('Discovery')
@ApiExtraModels(ErrorResponseDto)
@UseGuards(DiscoveryRateLimitGuard)
@Controller({ path: 'discovery/restaurants', version: '1' })
export class DiscoveryController {
  constructor(
    private readonly listDiscoverableRestaurantsUseCase: ListDiscoverableRestaurantsUseCase,
    private readonly getDiscoverableRestaurantUseCase: GetDiscoverableRestaurantUseCase,
    private readonly listDiscoverableBranchesUseCase: ListDiscoverableBranchesUseCase,
    private readonly getDiscoverableBranchUseCase: GetDiscoverableBranchUseCase,
    private readonly getDiscoverableFloorPlanUseCase: GetDiscoverableFloorPlanUseCase,
    private readonly listDiscoverableOffersUseCase: ListDiscoverableOffersUseCase,
    private readonly nearbyRestaurantsUseCase: NearbyRestaurantsUseCase,
    private readonly compareRestaurantsUseCase: CompareRestaurantsUseCase,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurants retrieved successfully.')
  @ApiOperation({
    operationId: 'discoveryListRestaurants',
    summary: 'Search/browse restaurants (public, unauthenticated)',
    description:
      'Paginated. With no filters/sort supplied, identical to the pre-Phase-15.5 plain listing (most-recently-created first). Phase 15.5 (architecture frozen 2026-07-29) adds optional `q` (name-only ILIKE), `cuisineId`/`occasionId` (relational taxonomy), `priceLevel`, `minRating`, `city`, and deterministic `sort`/`order`. Only `Active`, non-soft-deleted restaurants across every organization - discovery intentionally crosses tenant boundaries (this is the product purpose), never leaking `organizationId` or any other tenant-internal field. Each result also carries `hasActiveOffer`.',
  })
  @ApiResponse({
    status: 200,
    description: 'Restaurants retrieved',
    type: DiscoverableRestaurantListResponseDto,
  })
  @ApiErrorResponse(400, 'Invalid query parameters', ['VALIDATION_ERROR'])
  @ApiErrorResponse(429, 'Rate limit exceeded', ['RATE_LIMIT_EXCEEDED'])
  async listRestaurants(
    @Query() query: SearchRestaurantsQueryDto,
  ): Promise<DiscoverableRestaurantListResponseDto> {
    const result = await this.listDiscoverableRestaurantsUseCase.execute({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      q: query.q,
      cuisineId: query.cuisineId,
      occasionId: query.occasionId,
      priceLevel: query.priceLevel,
      minRating: query.minRating,
      city: query.city,
      sort: query.sort,
      order: query.order,
    });
    return {
      items: result.items.map(toDiscoverableRestaurantResponse),
      page: result.page,
      limit: result.limit,
      total: result.total,
    };
  }

  @Get('nearby')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Nearby restaurants retrieved successfully.')
  @ApiOperation({
    operationId: 'discoveryNearbyRestaurants',
    summary: 'Search restaurants near a location (public, unauthenticated)',
    description:
      'Phase 15.5 (architecture frozen 2026-07-29, D2-D4). Bounding-box prefilter on the existing Branch (latitude, longitude) B-tree index, refined by an exact Haversine distance calculation - no PostGIS/earthdistance/GiST. Results are Restaurant-rooted and deduplicated (a Restaurant with multiple qualifying Branches appears once, via its nearest qualifying Branch). Default radius 5km, max 50km. Always ordered distance ASC (not overridable in v1); the same optional q/cuisineId/occasionId/priceLevel/minRating filters as GET / are supported, but not city (location is already lat/lng-driven here) or sort.',
  })
  @ApiResponse({
    status: 200,
    description: 'Nearby restaurants retrieved',
    type: NearbyRestaurantListResponseDto,
  })
  @ApiErrorResponse(400, 'Invalid coordinates, radius, or other query parameters', [
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(429, 'Rate limit exceeded', ['RATE_LIMIT_EXCEEDED'])
  async nearbyRestaurants(
    @Query() query: NearbyRestaurantsQueryDto,
  ): Promise<NearbyRestaurantListResponseDto> {
    const result = await this.nearbyRestaurantsUseCase.execute({
      lat: query.lat,
      lng: query.lng,
      radiusKm: query.radiusKm ?? 5,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      q: query.q,
      cuisineId: query.cuisineId,
      occasionId: query.occasionId,
      priceLevel: query.priceLevel,
      minRating: query.minRating,
    });
    return {
      items: result.items.map(toNearbyRestaurantResponse),
      page: result.page,
      limit: result.limit,
      total: result.total,
    };
  }

  @Post('compare')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurants compared successfully.')
  @ApiOperation({
    operationId: 'discoveryCompareRestaurants',
    summary: 'Compare 2-5 restaurants side-by-side (public, unauthenticated)',
    description:
      'Phase 15.5 (architecture frozen 2026-07-29, D15/D18/D19), ADR-018 §"Comparison API". Stateless - no persistence, no comparison history. Preserves the caller-requested restaurantIds order. An id that does not resolve to a publicly-visible (Active, non-deleted) restaurant is silently omitted, never surfaced as a distinct error - `items` may contain fewer entries than requested.',
  })
  @ApiResponse({
    status: 200,
    description: 'Comparable restaurants retrieved',
    type: CompareRestaurantsResponseDto,
  })
  @ApiErrorResponse(400, 'restaurantIds must contain 2-5 unique UUIDs', ['VALIDATION_ERROR'])
  @ApiErrorResponse(429, 'Rate limit exceeded', ['RATE_LIMIT_EXCEEDED'])
  async compareRestaurants(
    @Body() body: CompareRestaurantsRequestDto,
  ): Promise<CompareRestaurantsResponseDto> {
    const result = await this.compareRestaurantsUseCase.execute({
      restaurantIds: body.restaurantIds,
    });
    return { items: result.items.map(toDiscoverableRestaurantResponse) };
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
  @ApiErrorResponse(429, 'Rate limit exceeded', ['RATE_LIMIT_EXCEEDED'])
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
  @ApiErrorResponse(429, 'Rate limit exceeded', ['RATE_LIMIT_EXCEEDED'])
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
  @ApiErrorResponse(429, 'Rate limit exceeded', ['RATE_LIMIT_EXCEEDED'])
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
      "Returns the branch's single active FloorPlan together with every non-soft-deleted Table on it, projected through the customer-safe shape (Phase 15.5, D11): table number, capacity, shape, and layout/geometry fields only - operational status and Merge/Split topology (mergeGroupId/isMergePrimary) are never exposed publicly. Returns 404 if the branch has no active FloorPlan configured yet. Table-level time/party-size availability is a separate call (GET /reservations/availability, ADR-013) - never duplicated here.",
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
  @ApiErrorResponse(429, 'Rate limit exceeded', ['RATE_LIMIT_EXCEEDED'])
  async getActiveFloorPlan(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ): Promise<FloorPlanWithTablesResponseDto> {
    const result = await this.getDiscoverableFloorPlanUseCase.execute({
      restaurantId,
      branchId,
    });
    return {
      floorPlan: toFloorPlanPublicResponse(result.floorPlan),
      tables: result.tables.map(toTablePublicResponse),
    };
  }

  @Get(':restaurantId/offers')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Offers retrieved successfully.')
  @ApiOperation({
    operationId: 'discoveryListOffers',
    summary: "Browse a restaurant's currently active public offers (public, unauthenticated)",
    description:
      "Phase 11 (Offers, 2026-07-28). Paginated, ordered most-recently-created first. Only offers that are Published AND startsAt <= now AND endsAt > now AND not soft-deleted - Draft, future-dated, Expired, and soft-deleted offers never appear here, regardless of whether the BullMQ expiration worker has already run. Compositional: delegates to the Offers module's own `ListPublicOffersUseCase`, never a duplicated business rule.",
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Active offers retrieved', type: OfferListResponseDto })
  @ApiErrorResponse(400, 'Invalid page/limit or restaurantId', ['VALIDATION_ERROR'])
  @ApiErrorResponse(404, 'Restaurant not found', ['NOT_FOUND'])
  @ApiErrorResponse(429, 'Rate limit exceeded', ['RATE_LIMIT_EXCEEDED'])
  async listOffers(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Query() query: ListOffersQueryDto,
  ): Promise<OfferListResponseDto> {
    const result = await this.listDiscoverableOffersUseCase.execute({
      restaurantId,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return toOfferListResponse(result);
  }
}
