import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { RestaurantUsage } from '../../domain/entities/restaurant-usage.entity';
import { RestaurantUsageRepository } from '../../domain/repositories/restaurant-usage.repository';
import { RestaurantUsagePrismaMapper } from './restaurant-usage.prisma-mapper';

/**
 * `RestaurantUsage` carries no `organizationId` column and is not in
 * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (ADR-027 §12) - tenant
 * resolution is transitive via `restaurantId -> Restaurant.organizationId`,
 * resolved by the calling use case through the already-tenant-scoped
 * `RestaurantRepository` first, exactly like `PrismaOfferRepository`'s own
 * doc comment. The ordinary tenant-scoped `PrismaContext` client is a safe
 * no-op passthrough for this model.
 */
@Injectable()
export class PrismaRestaurantUsageRepository implements RestaurantUsageRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findByRestaurantId(restaurantId: RestaurantId): Promise<RestaurantUsage | null> {
    const row = await this.prismaContext.client.restaurantUsage.findUnique({
      where: { restaurantId: restaurantId.value },
    });
    return row ? RestaurantUsagePrismaMapper.toDomain(row) : null;
  }

  async findManyByRestaurantIds(restaurantIds: RestaurantId[]): Promise<RestaurantUsage[]> {
    if (restaurantIds.length === 0) {
      return [];
    }
    const rows = await this.prismaContext.client.restaurantUsage.findMany({
      where: { restaurantId: { in: restaurantIds.map((id) => id.value) } },
    });
    return rows.map(RestaurantUsagePrismaMapper.toDomain);
  }

  async create(usage: RestaurantUsage): Promise<void> {
    const props = usage.toProps();
    await this.prismaContext.client.restaurantUsage.create({
      data: {
        id: props.id,
        restaurantId: props.restaurantId,
        branchCount: props.branchCount,
        employeeCount: props.employeeCount,
        updatedAt: props.updatedAt,
      },
    });
  }

  async incrementBranchCountIfUnderLimit(
    restaurantId: RestaurantId,
    limit: number,
  ): Promise<boolean> {
    const result = await this.prismaContext.client.restaurantUsage.updateMany({
      where: { restaurantId: restaurantId.value, branchCount: { lt: limit } },
      data: { branchCount: { increment: 1 }, updatedAt: new Date() },
    });
    return result.count > 0;
  }

  async incrementEmployeeCountIfUnderLimit(
    restaurantId: RestaurantId,
    limit: number,
  ): Promise<boolean> {
    const result = await this.prismaContext.client.restaurantUsage.updateMany({
      where: { restaurantId: restaurantId.value, employeeCount: { lt: limit } },
      data: { employeeCount: { increment: 1 }, updatedAt: new Date() },
    });
    return result.count > 0;
  }

  async decrementBranchCount(restaurantId: RestaurantId): Promise<void> {
    await this.prismaContext.client.restaurantUsage.updateMany({
      where: { restaurantId: restaurantId.value, branchCount: { gt: 0 } },
      data: { branchCount: { decrement: 1 }, updatedAt: new Date() },
    });
  }

  async decrementEmployeeCount(restaurantId: RestaurantId): Promise<void> {
    await this.prismaContext.client.restaurantUsage.updateMany({
      where: { restaurantId: restaurantId.value, employeeCount: { gt: 0 } },
      data: { employeeCount: { decrement: 1 }, updatedAt: new Date() },
    });
  }
}
