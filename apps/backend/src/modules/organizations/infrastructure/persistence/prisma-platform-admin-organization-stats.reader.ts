import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import {
  OrganizationMemberStatus,
  OrganizationStatus,
} from '../../domain/enums/organization.enums';
import {
  OrganizationDetailRow,
  OrganizationLookupQuery,
  OrganizationLookupRow,
  OrganizationStatusCounts,
  PlatformAdminOrganizationStatsReaderPort,
} from '../../application/ports/platform-admin-organization-stats-reader.port';

/**
 * ADR-035 Pattern 2 — deliberately injects the raw `PrismaService` instead of
 * `PrismaContext`, mirroring `PrismaPlatformAdminRestaurantLookupReader`'s own
 * justification: a platform-wide Organization status count has no single
 * `organizationId` to bind. Added by name to `.eslintrc.js`'s
 * `no-restricted-imports` `excludedFiles` whitelist. Read-only; includes
 * soft-deleted Organizations in the `deleted` count (Restore needs to know
 * they exist), matching the Restaurant reader's precedent.
 */
@Injectable()
export class PrismaPlatformAdminOrganizationStatsReader implements PlatformAdminOrganizationStatsReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async countByStatus(): Promise<OrganizationStatusCounts> {
    const [total, active, suspended, deleted] = await Promise.all([
      this.prisma.organization.count({ where: { deletedAt: null } }),
      this.prisma.organization.count({
        where: { deletedAt: null, status: OrganizationStatus.Active },
      }),
      this.prisma.organization.count({
        where: { deletedAt: null, status: OrganizationStatus.Suspended },
      }),
      this.prisma.organization.count({ where: { deletedAt: { not: null } } }),
    ]);
    return { total, active, suspended, deleted };
  }

  async search(
    query: OrganizationLookupQuery,
  ): Promise<{ items: OrganizationLookupRow[]; total: number }> {
    // Same composition rule as the Restaurant reader: a condition is added
    // only when it actually applies, so an omitted or blank filter
    // contributes no clause. Emitting `contains: ''` unconditionally would
    // degenerate to `LIKE '%%'` - a full scan that also drops NULLs.
    const conditions: Prisma.OrganizationWhereInput[] = [];

    const term = query.q?.trim();
    if (term) {
      conditions.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { slug: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    if (query.status === 'Deleted') {
      conditions.push({ deletedAt: { not: null } });
    } else if (query.status !== undefined) {
      conditions.push({ deletedAt: null, status: query.status });
    }

    const where: Prisma.OrganizationWhereInput = conditions.length > 0 ? { AND: conditions } : {};

    // One `where`, used by both queries - the total always describes the
    // same filter as the returned page.
    const [rows, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        select: { id: true, name: true, slug: true, status: true, deletedAt: true },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.organization.count({ where }),
    ]);

    return { items: rows, total };
  }

  async findDetailById(organizationId: string): Promise<OrganizationDetailRow | null> {
    const row = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        billingEmail: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        _count: {
          select: {
            // Soft-deleted restaurants and removed members are excluded, so
            // these counts mean "currently live", matching what the
            // Organization's own management views report.
            restaurants: { where: { deletedAt: null } },
            members: { where: { status: OrganizationMemberStatus.Active } },
          },
        },
      },
    });

    if (row === null) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      billingEmail: row.billingEmail,
      restaurantCount: row._count.restaurants,
      memberCount: row._count.members,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }
}
