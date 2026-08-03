import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { BranchResult } from '@modules/branches/application/dto/branch.result';
import { FloorPlanResult } from '@modules/tables/application/dto/floor-plan.result';
import { TableResult } from '@modules/tables/application/dto/table.result';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';
import { computeBoundingBox } from '../../domain/services/nearby-search-geo.util';
import {
  DiscoverableRestaurantFilters,
  DiscoverableRestaurantSort,
  DiscoveryListPage,
  DiscoveryReaderPort,
  ListRestaurantsParams,
  NearbyRestaurantResult,
  NearbySearchParams,
  SortOrder,
} from '../../application/ports/discovery-reader.port';

type DecimalLike = { toNumber(): number } | number | null;

function toNumberOrNull(value: DecimalLike): number | null {
  if (value === null) {
    return null;
  }
  return typeof value === 'number' ? value : value.toNumber();
}

interface NearbyRawRow {
  id: string;
  name: string;
  slug: string;
  logoId: string | null;
  coverImageId: string | null;
  description: string | null;
  cuisineType: string | null;
  averageRating: number | null;
  priceLevel: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  nearestBranchId: string;
  distanceKm: number;
}

/**
 * Deliberately injects the raw `PrismaService` instead of `PrismaContext`
 * (Phase 2.13.1 tenant-enforcement wiring) - the ESLint override in
 * `.eslintrc.js` excludes this file for the same reason
 * `prisma-restaurant-directory-reader.ts`/`prisma-login-organization-reader.ts`
 * are excluded (see `DiscoveryReaderPort`'s own doc comment for the full
 * reasoning). Every query here filters `deletedAt: null`; restaurant-facing
 * queries additionally filter `status: Active` - a Suspended or soft-deleted
 * restaurant is never publicly discoverable, exactly matching
 * `PrismaRestaurantDirectoryReader`'s own "does this restaurant exist and
 * is it not deleted" boundary. Returned rows never include
 * `organizationId` or any other tenant-internal field - the Result types
 * themselves structurally exclude it (see each Result interface's own
 * doc comment).
 *
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29) extends this
 * reader with `listRestaurants` filters/sort (D5/D6/D7), `getRestaurantsByIds`
 * (D18/D19 Comparison API), and `searchNearby` (D2/D4 bounding-box + Haversine
 * nearby search) - all under the exact same tenancy-bypass boundary, no new
 * mechanism (TENANCY.md).
 */
@Injectable()
export class PrismaDiscoveryReader implements DiscoveryReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async listRestaurants(
    params: ListRestaurantsParams,
  ): Promise<DiscoveryListPage<RestaurantResult>> {
    const where = this.buildRestaurantWhere(params);
    const orderBy = this.buildRestaurantOrderBy(params.sort, params.order);
    const [rows, total] = await Promise.all([
      this.prisma.restaurant.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.restaurant.count({ where }),
    ]);
    return { items: rows.map((row) => this.toRestaurantResult(row)), total };
  }

  async getRestaurantById(restaurantId: string): Promise<RestaurantResult | null> {
    const row = await this.prisma.restaurant.findUnique({ where: { id: restaurantId } });
    if (row === null || row.deletedAt !== null || row.status !== RestaurantStatus.Active) {
      return null;
    }
    return this.toRestaurantResult(row);
  }

  async getRestaurantsByIds(restaurantIds: string[]): Promise<RestaurantResult[]> {
    if (restaurantIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.restaurant.findMany({
      where: { id: { in: restaurantIds }, status: RestaurantStatus.Active, deletedAt: null },
    });
    return rows.map((row) => this.toRestaurantResult(row));
  }

  async searchNearby(
    params: NearbySearchParams,
  ): Promise<DiscoveryListPage<NearbyRestaurantResult>> {
    const base = this.buildNearbyBaseQuery(params);
    const offset = (params.page - 1) * params.limit;

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<NearbyRawRow[]>`
        ${base}
        ORDER BY n.distance_km ASC, r.id ASC
        LIMIT ${params.limit} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*)::bigint AS total FROM (${base}) AS counted
      `,
    ]);

    return {
      items: rows.map((row) => this.toNearbyRestaurantResult(row)),
      total: Number(countRows[0]?.total ?? 0n),
    };
  }

  async listBranchesByRestaurantId(
    restaurantId: string,
    page: number,
    limit: number,
  ): Promise<DiscoveryListPage<BranchResult>> {
    const where = { restaurantId, deletedAt: null };
    const [rows, total] = await Promise.all([
      this.prisma.branch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.branch.count({ where }),
    ]);
    return { items: rows.map((row) => this.toBranchResult(row)), total };
  }

  async getBranchById(branchId: string, restaurantId: string): Promise<BranchResult | null> {
    const row = await this.prisma.branch.findFirst({
      where: { id: branchId, restaurantId, deletedAt: null },
    });
    return row ? this.toBranchResult(row) : null;
  }

  async getActiveFloorPlanByBranchId(branchId: string): Promise<FloorPlanResult | null> {
    const row = await this.prisma.floorPlan.findFirst({
      where: { branchId, isActive: true, deletedAt: null },
    });
    return row ? this.toFloorPlanResult(row) : null;
  }

  async listTablesByFloorPlanId(floorPlanId: string): Promise<TableResult[]> {
    const rows = await this.prisma.table.findMany({
      where: { floorPlanId, deletedAt: null },
      orderBy: { tableNumber: 'asc' },
    });
    return rows.map((row) => this.toTableResult(row));
  }

  /** D5/D6/D7/D14 - see `DiscoverableRestaurantFilters`'s own doc comment for what each field does and does not match against. */
  private buildRestaurantWhere(
    filters: DiscoverableRestaurantFilters,
  ): Prisma.RestaurantWhereInput {
    const where: Prisma.RestaurantWhereInput = {
      status: RestaurantStatus.Active,
      deletedAt: null,
    };
    if (filters.q) {
      where.name = { contains: filters.q, mode: 'insensitive' };
    }
    if (filters.cuisineId) {
      where.cuisineCategories = { some: { cuisineCategoryId: filters.cuisineId } };
    }
    if (filters.occasionId) {
      where.occasionCategories = { some: { occasionCategoryId: filters.occasionId } };
    }
    if (filters.priceLevel !== undefined) {
      where.priceLevel = filters.priceLevel;
    }
    if (filters.minRating !== undefined) {
      where.averageRating = { gte: filters.minRating };
    }
    if (filters.city) {
      where.branches = {
        some: { city: { equals: filters.city, mode: 'insensitive' }, deletedAt: null },
      };
    }
    return where;
  }

  /**
   * D17 - every sort mode (including the unchanged plain-listing default)
   * carries a deterministic secondary tie-breaker (`id` ascending, i.e.
   * `restaurantId ASC`), so no list response ever depends on undefined
   * database row order.
   */
  private buildRestaurantOrderBy(
    sort: DiscoverableRestaurantSort | undefined,
    order: SortOrder | undefined,
  ): Prisma.RestaurantOrderByWithRelationInput[] {
    switch (sort) {
      case 'name':
        return [{ name: order ?? 'asc' }, { id: 'asc' }];
      case 'rating':
        return [{ averageRating: { sort: order ?? 'desc', nulls: 'last' } }, { id: 'asc' }];
      case 'newest':
        return [{ createdAt: order ?? 'desc' }, { id: 'asc' }];
      default:
        // Unchanged from the pre-Phase-15.5 plain listing behavior, now with
        // an explicit tie-breaker for full determinism (D17).
        return [{ createdAt: 'desc' }, { id: 'asc' }];
    }
  }

  /**
   * D4/D13 (nearby algorithm, bounding-box correctness): bounding-box
   * prefilter (`nearby_branches`) -> exact-radius Haversine refinement
   * (`radius_filtered`) -> Restaurant deduplication via
   * `DISTINCT ON (restaurant_id) ... ORDER BY restaurant_id, distance_km`
   * (`nearest_per_restaurant`, D2) -> the same optional filters `listRestaurants`
   * applies (D5/D6/D7), expressed as raw SQL against the same columns. Every
   * user-supplied value is passed as a `Prisma.sql` template parameter
   * (auto-parameterized by Prisma, never string-concatenated) - safe from SQL
   * injection. Returns the query *without* `ORDER BY`/`LIMIT`/`OFFSET`, so the
   * same base can be reused for both the page query and the `COUNT(*)` query.
   */
  private buildNearbyBaseQuery(params: NearbySearchParams): Prisma.Sql {
    const box = computeBoundingBox(params.lat, params.lng, params.radiusKm);
    const filterSql = this.buildNearbyFilterSql(params);

    return Prisma.sql`
      WITH nearby_branches AS (
        SELECT
          b.id AS branch_id,
          b.restaurant_id AS restaurant_id,
          (
            6371 * acos(
              LEAST(1, GREATEST(-1,
                cos(radians(${params.lat}::float8)) * cos(radians(b.latitude::float8)) * cos(radians(b.longitude::float8) - radians(${params.lng}::float8))
                + sin(radians(${params.lat}::float8)) * sin(radians(b.latitude::float8))
              ))
            )
          ) AS distance_km
        FROM branches b
        WHERE b.deleted_at IS NULL
          AND b.latitude IS NOT NULL
          AND b.longitude IS NOT NULL
          AND b.latitude BETWEEN ${box.minLat}::float8 AND ${box.maxLat}::float8
          AND (
            (${box.minLng}::float8 <= ${box.maxLng}::float8 AND b.longitude BETWEEN ${box.minLng}::float8 AND ${box.maxLng}::float8)
            OR
            (${box.minLng}::float8 > ${box.maxLng}::float8 AND (b.longitude >= ${box.minLng}::float8 OR b.longitude <= ${box.maxLng}::float8))
          )
      ),
      radius_filtered AS (
        SELECT * FROM nearby_branches WHERE distance_km <= ${params.radiusKm}::float8
      ),
      nearest_per_restaurant AS (
        SELECT DISTINCT ON (restaurant_id) restaurant_id, branch_id, distance_km
        FROM radius_filtered
        ORDER BY restaurant_id ASC, distance_km ASC, branch_id ASC
      )
      SELECT
        r.id AS "id",
        r.name AS "name",
        r.slug AS "slug",
        r.logo_id AS "logoId",
        r.cover_image_id AS "coverImageId",
        r.description AS "description",
        r.cuisine_type AS "cuisineType",
        r.average_rating::float8 AS "averageRating",
        r.price_level AS "priceLevel",
        r.status AS "status",
        r.created_at AS "createdAt",
        r.updated_at AS "updatedAt",
        n.branch_id AS "nearestBranchId",
        n.distance_km AS "distanceKm"
      FROM nearest_per_restaurant n
      JOIN restaurants r ON r.id = n.restaurant_id
      WHERE r.status = 'Active' AND r.deleted_at IS NULL
        ${filterSql}
    `;
  }

  private buildNearbyFilterSql(filters: DiscoverableRestaurantFilters): Prisma.Sql {
    const fragments: Prisma.Sql[] = [];
    if (filters.q) {
      fragments.push(Prisma.sql`AND r.name ILIKE ${`%${filters.q}%`}`);
    }
    if (filters.cuisineId) {
      fragments.push(
        Prisma.sql`AND EXISTS (SELECT 1 FROM restaurant_cuisine_categories rcc WHERE rcc.restaurant_id = r.id AND rcc.cuisine_category_id = ${filters.cuisineId}::uuid)`,
      );
    }
    if (filters.occasionId) {
      fragments.push(
        Prisma.sql`AND EXISTS (SELECT 1 FROM restaurant_occasion_categories roc WHERE roc.restaurant_id = r.id AND roc.occasion_category_id = ${filters.occasionId}::uuid)`,
      );
    }
    if (filters.priceLevel !== undefined) {
      fragments.push(Prisma.sql`AND r.price_level = ${filters.priceLevel}`);
    }
    if (filters.minRating !== undefined) {
      fragments.push(Prisma.sql`AND r.average_rating >= ${filters.minRating}`);
    }
    // Nearby's own route contract does not accept `city` (location is
    // already lat/lng-driven) - deliberately not composed here even though
    // `DiscoverableRestaurantFilters` carries the field for `listRestaurants`.
    return fragments.length > 0 ? Prisma.join(fragments, ' ') : Prisma.empty;
  }

  private toRestaurantResult(row: {
    id: string;
    name: string;
    slug: string;
    logoId: string | null;
    coverImageId: string | null;
    description: string | null;
    cuisineType: string | null;
    averageRating: DecimalLike;
    priceLevel: number | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): RestaurantResult {
    return {
      restaurantId: row.id,
      name: row.name,
      slug: row.slug,
      logoId: row.logoId,
      coverImageId: row.coverImageId,
      description: row.description,
      cuisineType: row.cuisineType,
      averageRating: toNumberOrNull(row.averageRating),
      priceLevel: row.priceLevel,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toNearbyRestaurantResult(row: NearbyRawRow): NearbyRestaurantResult {
    return {
      ...this.toRestaurantResult(row),
      nearestBranchId: row.nearestBranchId,
      distanceKm: row.distanceKm,
    };
  }

  private toBranchResult(row: {
    id: string;
    restaurantId: string;
    city: string;
    district: string | null;
    address: string;
    latitude: DecimalLike;
    longitude: DecimalLike;
    countryCode: string;
    currency: string | null;
    timezone: string;
    phone: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): BranchResult {
    return {
      branchId: row.id,
      restaurantId: row.restaurantId,
      city: row.city,
      district: row.district,
      address: row.address,
      latitude: toNumberOrNull(row.latitude),
      longitude: toNumberOrNull(row.longitude),
      countryCode: row.countryCode,
      currency: row.currency,
      timezone: row.timezone,
      phone: row.phone,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toFloorPlanResult(row: {
    id: string;
    branchId: string;
    name: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): FloorPlanResult {
    return {
      floorPlanId: row.id,
      branchId: row.branchId,
      name: row.name,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toTableResult(row: {
    id: string;
    branchId: string;
    floorPlanId: string;
    tableNumber: string;
    capacity: number;
    floor: number | null;
    positionX: number | null;
    positionY: number | null;
    width: number | null;
    height: number | null;
    rotation: number | null;
    shape: string;
    layer: number | null;
    indoor: boolean;
    vip: boolean;
    smoking: boolean;
    status: string;
    mergeGroupId: string | null;
    isMergePrimary: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): TableResult {
    return {
      tableId: row.id,
      branchId: row.branchId,
      floorPlanId: row.floorPlanId,
      tableNumber: row.tableNumber,
      capacity: row.capacity,
      floor: row.floor,
      positionX: row.positionX,
      positionY: row.positionY,
      width: row.width,
      height: row.height,
      rotation: row.rotation,
      shape: row.shape as TableShape,
      layer: row.layer,
      indoor: row.indoor,
      vip: row.vip,
      smoking: row.smoking,
      status: row.status as TableStatus,
      mergeGroupId: row.mergeGroupId,
      isMergePrimary: row.isMergePrimary,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
