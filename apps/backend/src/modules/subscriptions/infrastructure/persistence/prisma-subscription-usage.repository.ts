import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { SubscriptionUsage } from '../../domain/entities/subscription-usage.entity';
import { SubscriptionUsageRepository } from '../../domain/repositories/subscription-usage.repository';

/**
 * `SubscriptionUsage` is a `DIRECT_TENANT_OWNED_MODEL` (ADR-027 §12) - same
 * auto-scoping reasoning as `PrismaSubscriptionRepository`. The atomic
 * conditional increment (D15) uses Prisma's own `{ increment: 1 }` +
 * `{ lt: limit }` combination - a single `UPDATE ... SET x = x + 1 WHERE
 * x < limit` statement, no raw SQL needed, and the tenant-scoping
 * extension still auto-injects `organizationId` into the `where` clause of
 * this ordinary `updateMany` call.
 */
@Injectable()
export class PrismaSubscriptionUsageRepository implements SubscriptionUsageRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findByOrganizationId(): Promise<SubscriptionUsage | null> {
    const row = await this.prismaContext.client.subscriptionUsage.findFirst({ where: {} });
    return row
      ? SubscriptionUsage.reconstitute({
          id: row.id,
          organizationId: row.organizationId,
          restaurantCount: row.restaurantCount,
          updatedAt: row.updatedAt,
        })
      : null;
  }

  async create(usage: SubscriptionUsage): Promise<void> {
    const props = usage.toProps();
    await this.prismaContext.client.subscriptionUsage.create({
      data: {
        id: props.id,
        organizationId: props.organizationId,
        restaurantCount: props.restaurantCount,
        updatedAt: props.updatedAt,
      },
    });
  }

  async incrementRestaurantCountIfUnderLimit(
    organizationId: string,
    limit: number,
  ): Promise<boolean> {
    const result = await this.prismaContext.client.subscriptionUsage.updateMany({
      where: { organizationId, restaurantCount: { lt: limit } },
      data: { restaurantCount: { increment: 1 }, updatedAt: new Date() },
    });
    return result.count > 0;
  }

  async decrementRestaurantCount(organizationId: string): Promise<void> {
    await this.prismaContext.client.subscriptionUsage.updateMany({
      where: { organizationId, restaurantCount: { gt: 0 } },
      data: { restaurantCount: { decrement: 1 }, updatedAt: new Date() },
    });
  }
}
