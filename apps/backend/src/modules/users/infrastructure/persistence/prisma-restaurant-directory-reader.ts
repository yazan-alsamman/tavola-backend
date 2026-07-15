import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import {
  RestaurantDirectoryReaderPort,
  RestaurantSummary,
} from '../../application/ports/restaurant-directory-reader.port';

const SELECT_FIELDS = {
  id: true,
  name: true,
  slug: true,
  cuisineType: true,
  priceLevel: true,
  averageRating: true,
  status: true,
  deletedAt: true,
} as const;

type SelectedRestaurantRow = {
  id: string;
  name: string;
  slug: string;
  cuisineType: string | null;
  priceLevel: number | null;
  averageRating: { toNumber(): number } | null;
  status: string;
  deletedAt: Date | null;
};

/**
 * Deliberately injects the raw `PrismaService` instead of `PrismaContext`
 * (Phase 2.13.1 tenant-enforcement wiring) - the ESLint override in
 * `.eslintrc.js` that blocks direct `PrismaService` imports from
 * `modules/**\/infrastructure/persistence/**` explicitly excludes this file
 * for the same reason `prisma-login-organization-reader.ts` is excluded.
 *
 * This query touches `Restaurant` (a tenant-owned model per ADR-012) but
 * must NOT go through the tenant-scoped client: Favorites is customer-facing
 * discovery data, and a plain `User` actor never has an `organizationId` to
 * scope by (see the port's own doc comment). The security boundary this
 * read protects is "does this restaurant exist and is it not deleted" -
 * identical, non-tenant-owner-specific, publicly-discoverable information a
 * future Discovery module (Phase 15.5) would expose the same way - never
 * "only this tenant's restaurants" (there is no tenant identity here to
 * scope by in the first place). It cannot leak organization-private data
 * because the returned `RestaurantSummary` never includes `organizationId`
 * or any other tenant-internal field.
 */
@Injectable()
export class PrismaRestaurantDirectoryReader implements RestaurantDirectoryReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async findById(restaurantId: string): Promise<RestaurantSummary | null> {
    const row = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: SELECT_FIELDS,
    });
    return this.toSummary(row);
  }

  async findManyByIds(restaurantIds: string[]): Promise<RestaurantSummary[]> {
    if (restaurantIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.restaurant.findMany({
      where: { id: { in: restaurantIds } },
      select: SELECT_FIELDS,
    });
    return rows
      .map((row) => this.toSummary(row))
      .filter((summary): summary is RestaurantSummary => summary !== null);
  }

  private toSummary(row: SelectedRestaurantRow | null): RestaurantSummary | null {
    if (row === null || row.deletedAt !== null) {
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      cuisineType: row.cuisineType,
      priceLevel: row.priceLevel,
      averageRating: row.averageRating === null ? null : row.averageRating.toNumber(),
      status: row.status,
    };
  }
}
