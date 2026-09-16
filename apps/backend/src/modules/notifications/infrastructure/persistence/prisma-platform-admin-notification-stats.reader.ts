import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { NotificationPushStatus } from '../../domain/enums/notification.enums';
import {
  NotificationBroadcastHistoryQuery,
  NotificationBroadcastHistoryRow,
  NotificationPushStatusCounts,
  PlatformAdminNotificationStatsReaderPort,
} from '../../application/ports/platform-admin-notification-stats-reader.port';

/**
 * ADR-035 Pattern 2 — deliberately injects the raw `PrismaService` instead of
 * the tenant-scoped repository, mirroring
 * `PrismaPlatformAdminOrganizationStatsReader`'s justification: a
 * platform-wide status count has no single `organizationId` to bind. Added
 * by name to `.eslintrc.js`'s `no-restricted-imports` `excludedFiles`
 * whitelist. Read-only.
 *
 * A single `groupBy` query (not four separate `.count()` calls, not a load-
 * every-row-into-memory count) — one round trip to PostgreSQL regardless of
 * table size, per this phase's "prefer database-level aggregation" rule.
 * Missing statuses (no rows in that state yet) default to 0 rather than
 * being absent from the result, so the response shape is always complete.
 */
@Injectable()
export class PrismaPlatformAdminNotificationStatsReader implements PlatformAdminNotificationStatsReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async countByPushStatus(): Promise<NotificationPushStatusCounts> {
    const groups = await this.prisma.notification.groupBy({
      by: ['pushStatus'],
      _count: { _all: true },
    });

    const counts: Record<NotificationPushStatus, number> = {
      [NotificationPushStatus.NotAttempted]: 0,
      [NotificationPushStatus.Queued]: 0,
      [NotificationPushStatus.Accepted]: 0,
      [NotificationPushStatus.Failed]: 0,
    };
    let total = 0;
    for (const group of groups) {
      counts[group.pushStatus as NotificationPushStatus] = group._count._all;
      total += group._count._all;
    }

    return {
      total,
      notAttempted: counts[NotificationPushStatus.NotAttempted],
      queued: counts[NotificationPushStatus.Queued],
      accepted: counts[NotificationPushStatus.Accepted],
      failed: counts[NotificationPushStatus.Failed],
    };
  }

  async listBroadcasts(
    query: NotificationBroadcastHistoryQuery,
  ): Promise<{ items: NotificationBroadcastHistoryRow[]; total: number }> {
    // Only applied filters contribute a clause; an omitted filter leaves the
    // listing unrestricted rather than matching an empty value.
    const where: Prisma.NotificationBroadcastWhereInput = {};
    if (query.status) {
      where.status = query.status as Prisma.EnumNotificationBroadcastStatusFilter['equals'];
    }
    if (query.senderType) {
      where.senderType =
        query.senderType as Prisma.EnumNotificationBroadcastSenderTypeFilter['equals'];
    }

    // Every column below is persisted state written by the aggregate itself
    // (`CreateNotificationBroadcastService` on insert, then
    // `NotificationBroadcast.recordBatch`/`complete`/`fail` from the fan-out
    // processor). Nothing is derived or reconstructed here.
    const [rows, total] = await Promise.all([
      this.prisma.notificationBroadcast.findMany({
        where,
        select: {
          id: true,
          senderType: true,
          senderId: true,
          organizationId: true,
          title: true,
          body: true,
          totalRecipients: true,
          processedCount: true,
          succeededCount: true,
          failedCount: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.notificationBroadcast.count({ where }),
    ]);

    return { items: rows, total };
  }
}
