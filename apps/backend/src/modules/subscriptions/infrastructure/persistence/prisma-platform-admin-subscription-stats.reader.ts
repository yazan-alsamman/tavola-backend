import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { SubscriptionStatus } from '../../domain/enums/subscription.enums';
import {
  PlatformAdminSubscriptionStatsReaderPort,
  SubscriptionStatusCounts,
} from '../../application/ports/platform-admin-subscription-stats-reader.port';

/**
 * ADR-035 Pattern 2 — deliberately injects the raw `PrismaService` instead of
 * the tenant-scoped repository, mirroring
 * `PrismaPlatformAdminOrganizationStatsReader`'s justification: a
 * platform-wide status count has no single `organizationId` to bind. Added
 * by name to `.eslintrc.js`'s `no-restricted-imports` `excludedFiles`
 * whitelist. Read-only.
 */
@Injectable()
export class PrismaPlatformAdminSubscriptionStatsReader implements PlatformAdminSubscriptionStatsReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async countByStatus(): Promise<SubscriptionStatusCounts> {
    const [total, active, suspended, cancelled, expired] = await Promise.all([
      this.prisma.subscription.count(),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.Active } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.Suspended } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.Cancelled } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.Expired } }),
    ]);
    return { total, active, suspended, cancelled, expired };
  }
}
