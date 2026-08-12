import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { NotificationPushStatus } from '../../domain/enums/notification.enums';
import {
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
}
