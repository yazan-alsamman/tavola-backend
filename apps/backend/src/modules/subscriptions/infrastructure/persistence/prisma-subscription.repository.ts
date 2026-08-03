import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { SubscriptionId } from '@shared/domain/value-objects/identifiers.vo';
import { Subscription } from '../../domain/entities/subscription.entity';
import { SubscriptionStatus } from '../../domain/enums/subscription.enums';
import { SubscriptionRepository } from '../../domain/repositories/subscription.repository';
import { SubscriptionPrismaMapper } from './subscription.prisma-mapper';

/**
 * `Subscription` is a `DIRECT_TENANT_OWNED_MODEL` (ADR-027 §12,
 * `tenant-scoped-prisma.extension.ts`) - the injected `PrismaContext`
 * client scopes every query/write to the caller's bound `TenantContext`
 * automatically (fail-closed if none is bound), so no method here takes an
 * explicit `organizationId` parameter, matching
 * `PrismaRestaurantRepository`'s own doc comment.
 */
@Injectable()
export class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findByOrganizationId(): Promise<Subscription | null> {
    const row = await this.prismaContext.client.subscription.findFirst({ where: {} });
    return row ? SubscriptionPrismaMapper.toDomain(row) : null;
  }

  /** Cross-tenant (BullMQ System actor) - bypasses tenant scoping via raw query, safe because it only ever reads the one already-known id, never a caller-influenced filter (mirrors `PrismaRestaurantRepository.existsPubliclyById`'s own reasoning). */
  async findById(id: SubscriptionId): Promise<Subscription | null> {
    const rows = await this.prismaContext.client.$queryRaw<
      Array<{
        id: string;
        organization_id: string;
        subscription_plan_id: string;
        status: string;
        starts_at: Date;
        ends_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      SELECT id, organization_id, subscription_plan_id, status, starts_at, ends_at, created_at, updated_at
      FROM subscriptions
      WHERE id = ${id.value}::uuid
    `;
    const row = rows[0];
    if (!row) {
      return null;
    }
    return Subscription.reconstitute({
      id: row.id,
      organizationId: row.organization_id,
      subscriptionPlanId: row.subscription_plan_id,
      status: row.status as SubscriptionStatus,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  async create(subscription: Subscription): Promise<void> {
    const data = SubscriptionPrismaMapper.toPersistence(subscription);
    await this.prismaContext.client.subscription.create({ data });
  }

  async updateIfStatus(
    subscription: Subscription,
    expectedStatus: SubscriptionStatus,
  ): Promise<boolean> {
    const data = SubscriptionPrismaMapper.toPersistence(subscription);
    const result = await this.prismaContext.client.subscription.updateMany({
      where: { id: data.id, status: expectedStatus },
      data: {
        subscriptionPlanId: data.subscriptionPlanId,
        status: data.status,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        updatedAt: data.updatedAt,
      },
    });
    return result.count > 0;
  }

  /** BullMQ expiration job's sole write - cross-tenant (System actor), bypasses tenant scoping via raw SQL, same reasoning as `findById` above. */
  async expireIfActiveAndDue(id: SubscriptionId, at: Date): Promise<boolean> {
    const result = await this.prismaContext.client.$executeRaw`
      UPDATE subscriptions
      SET status = 'Expired', updated_at = ${at}
      WHERE id = ${id.value}::uuid AND status = 'Active' AND ends_at IS NOT NULL AND ends_at <= ${at}
    `;
    return result > 0;
  }
}
