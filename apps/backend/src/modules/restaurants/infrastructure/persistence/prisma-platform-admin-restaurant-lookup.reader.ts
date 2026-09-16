import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { RestaurantStatus } from '../../domain/enums/restaurant.enums';
import {
  PlatformAdminRestaurantLookup,
  PlatformAdminRestaurantLookupReaderPort,
  RestaurantDetailRow,
  RestaurantLookupQuery,
  RestaurantLookupRow,
  RestaurantStatusCounts,
} from '../../application/ports/platform-admin-restaurant-lookup-reader.port';

/**
 * ADR-035 Pattern 2 — deliberately injects the raw `PrismaService` instead of
 * `PrismaContext`, mirroring `PrismaRestaurantDirectoryReader`/
 * `PrismaDiscoveryReader`'s own justification: no single `organizationId` can
 * be bound yet, because discovering which Organization owns this Restaurant
 * id IS the read this class exists to perform. Added by name to
 * `.eslintrc.js`'s `no-restricted-imports` `excludedFiles` whitelist.
 *
 * Unlike those three existing readers (all customer-facing, all structurally
 * exclude `organizationId` from their response), this one is the Platform
 * Back Office case ADR-035 §3 calls out explicitly: it MUST include
 * `organizationId`, since finding it is the entire point — the caller
 * (a PlatformAdmin Restaurant lifecycle use case) immediately uses it to
 * Explicit-Tenant-Rebind (Pattern 1) before performing any actual mutation.
 * Read-only; includes soft-deleted restaurants (Restore needs to find one).
 */
@Injectable()
export class PrismaPlatformAdminRestaurantLookupReader implements PlatformAdminRestaurantLookupReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async findOrganizationIdByRestaurantId(
    restaurantId: string,
  ): Promise<PlatformAdminRestaurantLookup | null> {
    const row = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, organizationId: true },
    });
    return row ? { restaurantId: row.id, organizationId: row.organizationId } : null;
  }

  async countByStatus(): Promise<RestaurantStatusCounts> {
    const [total, active, suspended, deleted] = await Promise.all([
      this.prisma.restaurant.count({ where: { deletedAt: null } }),
      this.prisma.restaurant.count({ where: { deletedAt: null, status: RestaurantStatus.Active } }),
      this.prisma.restaurant.count({
        where: { deletedAt: null, status: RestaurantStatus.Suspended },
      }),
      this.prisma.restaurant.count({ where: { deletedAt: { not: null } } }),
    ]);
    return { total, active, suspended, deleted };
  }

  async search(
    query: RestaurantLookupQuery,
  ): Promise<{ items: RestaurantLookupRow[]; total: number }> {
    // Conditions are composed into one `AND` array and only pushed when they
    // actually apply, so an omitted (or blank) filter contributes no clause
    // at all. The alternative - always emitting `contains: q` - degenerates
    // into `LIKE '%%'` for an empty `q`, which is a full scan that also
    // silently excludes NULLs. Trimming matters for the same reason: `q=" "`
    // is a user who typed nothing, not a search for a space.
    const conditions: Prisma.RestaurantWhereInput[] = [];

    const term = query.q?.trim();
    if (term) {
      conditions.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { slug: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    // `Deleted` is the soft-delete axis, not a `status` value (ADR-034 §3);
    // `Active`/`Suspended` exclude soft-deleted rows, so a suspended-then-
    // deleted Restaurant appears under `Deleted` only, never under both.
    if (query.status === 'Deleted') {
      conditions.push({ deletedAt: { not: null } });
    } else if (query.status !== undefined) {
      conditions.push({ deletedAt: null, status: query.status });
    }

    const where: Prisma.RestaurantWhereInput = conditions.length > 0 ? { AND: conditions } : {};

    // The same `where` drives both the page and the count, so the reported
    // total can never describe a different filter than the rows do.
    const [rows, total] = await Promise.all([
      this.prisma.restaurant.findMany({
        where,
        select: {
          id: true,
          organizationId: true,
          name: true,
          slug: true,
          status: true,
          deletedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.restaurant.count({ where }),
    ]);

    return { items: rows, total };
  }

  async findDetailById(restaurantId: string): Promise<RestaurantDetailRow | null> {
    const row = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        id: true,
        organizationId: true,
        name: true,
        slug: true,
        description: true,
        cuisineType: true,
        priceLevel: true,
        averageRating: true,
        logoId: true,
        coverImageId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        organization: { select: { name: true, slug: true, status: true } },
        // Counted in the same round trip rather than a follow-up query -
        // excludes soft-deleted branches, matching what the tenant-facing
        // branch list would report.
        _count: { select: { branches: { where: { deletedAt: null } } } },
      },
    });

    if (row === null) {
      return null;
    }

    return {
      id: row.id,
      organizationId: row.organizationId,
      organizationName: row.organization.name,
      organizationSlug: row.organization.slug,
      organizationStatus: row.organization.status,
      name: row.name,
      slug: row.slug,
      description: row.description,
      cuisineType: row.cuisineType,
      priceLevel: row.priceLevel,
      // Prisma returns Decimal for this column; Number() keeps the port's
      // contract a plain number so no consumer has to know about Decimal.
      averageRating: row.averageRating === null ? null : Number(row.averageRating),
      logoId: row.logoId,
      coverImageId: row.coverImageId,
      status: row.status,
      branchCount: row._count.branches,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }
}
