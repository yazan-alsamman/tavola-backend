import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { SubscriptionPlanId } from '@shared/domain/value-objects/identifiers.vo';
import { SubscriptionPlan } from '../../domain/entities/subscription-plan.entity';
import { SubscriptionPlanRepository } from '../../domain/repositories/subscription-plan.repository';
import { SubscriptionPlanPrismaMapper } from './subscription-plan.prisma-mapper';

/**
 * `SubscriptionPlan` is platform-global (TENANCY.md) - not in
 * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`, so the ordinary
 * tenant-scoped `PrismaContext` client is a safe no-op passthrough here,
 * exactly like `PrismaOfferRepository`'s own doc comment explains.
 */
@Injectable()
export class PrismaSubscriptionPlanRepository implements SubscriptionPlanRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findById(id: SubscriptionPlanId): Promise<SubscriptionPlan | null> {
    const row = await this.prismaContext.client.subscriptionPlan.findUnique({
      where: { id: id.value },
    });
    return row ? SubscriptionPlanPrismaMapper.toDomain(row) : null;
  }

  async findBySlug(slug: string): Promise<SubscriptionPlan | null> {
    const row = await this.prismaContext.client.subscriptionPlan.findUnique({ where: { slug } });
    return row ? SubscriptionPlanPrismaMapper.toDomain(row) : null;
  }

  async findMany(): Promise<SubscriptionPlan[]> {
    const rows = await this.prismaContext.client.subscriptionPlan.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(SubscriptionPlanPrismaMapper.toDomain);
  }

  async save(plan: SubscriptionPlan): Promise<void> {
    const data = SubscriptionPlanPrismaMapper.toPersistence(plan);
    await this.prismaContext.client.subscriptionPlan.upsert({
      where: { id: data.id },
      create: data,
      update: {
        name: data.name,
        slug: data.slug,
        maxRestaurants: data.maxRestaurants,
        maxBranchesPerRestaurant: data.maxBranchesPerRestaurant,
        maxEmployeesPerRestaurant: data.maxEmployeesPerRestaurant,
        archivedAt: data.archivedAt,
        updatedAt: data.updatedAt,
      },
    });
  }
}
