import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { BranchResult } from '@modules/branches/application/dto/branch.result';
import { FloorPlanResult } from '@modules/tables/application/dto/floor-plan.result';
import { TableResult } from '@modules/tables/application/dto/table.result';
import { TableShape, TableStatus } from '@modules/tables/domain/enums/table.enums';
import {
  DiscoveryListPage,
  DiscoveryReaderPort,
} from '../../application/ports/discovery-reader.port';

type DecimalLike = { toNumber(): number } | null;

function toNumberOrNull(value: DecimalLike): number | null {
  return value === null ? null : value.toNumber();
}

/**
 * Deliberately injects the raw `PrismaService` instead of `PrismaContext`
 * (Phase 2.13.1 tenant-enforcement wiring) - the ESLint override in
 * `.eslintrc.js` excludes this file for the same reason
 * `prisma-restaurant-directory-reader.ts`/`prisma-login-organization-reader.ts`
 * are excluded (see `DiscoveryReaderPort`'s own doc comment for the full
 * reasoning). Every query here filters `deletedAt: null`; `listRestaurants`/
 * `getRestaurantById` additionally filter `status: Active` - a Suspended or
 * soft-deleted restaurant is never publicly discoverable, exactly matching
 * `PrismaRestaurantDirectoryReader`'s own "does this restaurant exist and
 * is it not deleted" boundary. Returned rows never include
 * `organizationId` or any other tenant-internal field - the Result types
 * themselves structurally exclude it (see each Result interface's own
 * doc comment).
 */
@Injectable()
export class PrismaDiscoveryReader implements DiscoveryReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async listRestaurants(page: number, limit: number): Promise<DiscoveryListPage<RestaurantResult>> {
    const where = { status: RestaurantStatus.Active, deletedAt: null };
    const [rows, total] = await Promise.all([
      this.prisma.restaurant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
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
