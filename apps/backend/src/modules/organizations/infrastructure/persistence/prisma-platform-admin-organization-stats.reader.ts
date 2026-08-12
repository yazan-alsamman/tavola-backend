import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { OrganizationStatus } from '../../domain/enums/organization.enums';
import {
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
    q: string,
    page: number,
    limit: number,
  ): Promise<{ items: OrganizationLookupRow[]; total: number }> {
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { slug: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [rows, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        select: { id: true, name: true, slug: true, status: true, deletedAt: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.organization.count({ where }),
    ]);

    return { items: rows, total };
  }
}
