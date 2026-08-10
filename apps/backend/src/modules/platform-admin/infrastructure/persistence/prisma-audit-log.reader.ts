import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import {
  AuditLogReaderPort,
  ListAuditLogsFilter,
  ListAuditLogsResult,
} from '../../application/ports/audit-log-reader.port';

/**
 * ADR-035 Pattern 2 (Tenant-Agnostic Raw Reader) - the third `.eslintrc.js`
 * -whitelisted Platform Back Office reader (after
 * `PrismaPlatformAdminRestaurantLookupReader`, Phase 19.1, and
 * `PrismaAcquisitionCrossTenantReader`, Phase 19.2). Deliberately injects the
 * raw `PrismaService`, not `PrismaContext`: `AuditLog` is not in
 * `DIRECT_TENANT_OWNED_MODELS` (see `PrismaAuditLogWriter`'s own doc
 * comment - most audited actions happen with no tenant context bound at
 * all), so the tenant-scoping extension is a verified no-op for this model
 * either way, but the raw client keeps every genuinely cross-tenant read
 * path enumerable via the ESLint whitelist itself (ADR-035 §5), the same
 * classification discipline `PrismaAcquisitionCrossTenantReader` follows.
 *
 * Prisma's typed query builder is sufficient here (no `$queryRaw`) - unlike
 * Revenue Reporting's `groupBy`, this is a plain filtered list with no JOIN
 * and no date-truncation aggregation, so every filter is an ordinary,
 * automatically-parameterized Prisma `where` clause - no injection surface.
 */
@Injectable()
export class PrismaAuditLogReader implements AuditLogReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: ListAuditLogsFilter): Promise<ListAuditLogsResult> {
    const where: Prisma.AuditLogWhereInput = {
      occurredAt: { gte: filter.from, lt: filter.to },
      ...(filter.actorId ? { actorId: filter.actorId } : {}),
      ...(filter.targetType ? { targetType: filter.targetType } : {}),
      ...(filter.targetId ? { targetId: filter.targetId } : {}),
      ...(filter.action ? { action: filter.action } : {}),
      ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorType: row.actorType,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        organizationId: row.organizationId,
        correlationId: row.correlationId,
        ipAddress: row.ipAddress,
        occurredAt: row.occurredAt,
      })),
      total,
    };
  }
}
