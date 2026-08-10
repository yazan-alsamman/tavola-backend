import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { CustomerAcquisitionId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { CustomerAcquisition } from '../../domain/entities/customer-acquisition.entity';
import { AcquisitionStatus } from '../../domain/enums/customer-acquisition.enums';
import { CustomerAcquisitionRepository } from '../../domain/repositories/customer-acquisition.repository';
import { CustomerAcquisitionPrismaMapper } from './customer-acquisition.prisma-mapper';

/**
 * `CustomerAcquisition` is transitively tenant-owned via
 * `restaurantId -> Restaurant.organizationId` (identical shape to
 * `RestaurantUsage`, ADR-027 §12) - not in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS`, so the ordinary `PrismaContext` client is a
 * safe passthrough here regardless of whether a tenant identity is bound
 * (mirrors `PrismaOfferRepository`/`PrismaSubscriptionPlanRepository`'s own
 * doc comments) - callers relying on tenant isolation must resolve the
 * parent Restaurant themselves first, exactly like every other
 * transitively-owned repository in this codebase.
 */
@Injectable()
export class PrismaCustomerAcquisitionRepository implements CustomerAcquisitionRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findById(id: CustomerAcquisitionId): Promise<CustomerAcquisition | null> {
    const row = await this.prismaContext.client.customerAcquisition.findUnique({
      where: { id: id.value },
    });
    return row ? CustomerAcquisitionPrismaMapper.toDomain(row) : null;
  }

  async findActiveByRestaurantAndIdentity(
    restaurantId: RestaurantId,
    userId: string | null,
    reservationGuestId: string | null,
  ): Promise<CustomerAcquisition | null> {
    const row = await this.prismaContext.client.customerAcquisition.findFirst({
      where: {
        restaurantId: restaurantId.value,
        userId,
        reservationGuestId,
        status: { not: AcquisitionStatus.Reversed },
      },
    });
    return row ? CustomerAcquisitionPrismaMapper.toDomain(row) : null;
  }

  async findManyByRestaurantId(
    restaurantId: RestaurantId,
    page: number,
    limit: number,
  ): Promise<{ items: CustomerAcquisition[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prismaContext.client.customerAcquisition.findMany({
        where: { restaurantId: restaurantId.value },
        orderBy: { recordedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.customerAcquisition.count({
        where: { restaurantId: restaurantId.value },
      }),
    ]);
    return { items: rows.map(CustomerAcquisitionPrismaMapper.toDomain), total };
  }

  async countRecordedInWindow(restaurantId: RestaurantId, from: Date, to: Date): Promise<number> {
    return this.prismaContext.client.customerAcquisition.count({
      where: {
        restaurantId: restaurantId.value,
        status: AcquisitionStatus.Recorded,
        recordedAt: { gte: from, lt: to },
      },
    });
  }

  /**
   * ADR-033 §9 - the partial unique index
   * (`customer_acquisitions_restaurant_user_active_key`/`..._guest_active_key`)
   * is the actual concurrency authority; a concurrent-insert `P2002` here is
   * swallowed as "already acquired, no-op" - mirrors
   * `PrismaConversationParticipantRepository.create()`'s exact precedent.
   */
  async createIfNotExists(acquisition: CustomerAcquisition): Promise<boolean> {
    const data = CustomerAcquisitionPrismaMapper.toPersistence(acquisition);
    try {
      await this.prismaContext.client.customerAcquisition.create({ data });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  }

  async save(acquisition: CustomerAcquisition): Promise<void> {
    const data = CustomerAcquisitionPrismaMapper.toPersistence(acquisition);
    await this.prismaContext.client.customerAcquisition.update({
      where: { id: data.id },
      data: {
        status: data.status,
        reversedAt: data.reversedAt,
        reversedBy: data.reversedBy,
        reversalReason: data.reversalReason,
        updatedAt: data.updatedAt,
      },
    });
  }
}
