import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { BranchId, FloorPlanId } from '@shared/domain/value-objects/identifiers.vo';
import { FloorPlan } from '../../domain/entities/floor-plan.entity';
import { FloorPlanRepository } from '../../domain/repositories/floor-plan.repository';
import { FloorPlanPrismaMapper } from './floor-plan.prisma-mapper';

/**
 * `FloorPlan` is NOT in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (no
 * direct `organizationId` column), so queries here run through the
 * tenant-scoped `PrismaContext` client as a verified no-op passthrough -
 * exactly like `PrismaBranchRepository`. This repository provides NO tenant
 * isolation by itself. Every consuming use case MUST resolve the parent
 * Restaurant then the parent Branch via their already-tenant-scoped
 * repositories first.
 */
@Injectable()
export class PrismaFloorPlanRepository implements FloorPlanRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findByIdAndBranchId(id: FloorPlanId, branchId: BranchId): Promise<FloorPlan | null> {
    const row = await this.prismaContext.client.floorPlan.findFirst({
      where: { id: id.value, branchId: branchId.value, deletedAt: null },
    });
    return row ? FloorPlanPrismaMapper.toDomain(row) : null;
  }

  async findManyByBranchId(branchId: BranchId): Promise<FloorPlan[]> {
    const rows = await this.prismaContext.client.floorPlan.findMany({
      where: { branchId: branchId.value, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(FloorPlanPrismaMapper.toDomain);
  }

  async existsAnyForBranch(branchId: BranchId): Promise<boolean> {
    const count = await this.prismaContext.client.floorPlan.count({
      where: { branchId: branchId.value, deletedAt: null },
    });
    return count > 0;
  }

  async save(floorPlan: FloorPlan): Promise<void> {
    const data = FloorPlanPrismaMapper.toPersistence(floorPlan);
    await this.prismaContext.client.floorPlan.upsert({
      where: { id: data.id },
      create: data,
      update: {
        name: data.name,
        isActive: data.isActive,
        updatedAt: data.updatedAt,
        deletedAt: data.deletedAt,
      },
    });
  }

  async activate(id: FloorPlanId, branchId: BranchId, at: Date): Promise<FloorPlan> {
    return this.prismaContext.runInTransaction(async () => {
      await this.prismaContext.client.floorPlan.updateMany({
        where: {
          branchId: branchId.value,
          isActive: true,
          deletedAt: null,
          NOT: { id: id.value },
        },
        data: { isActive: false, updatedAt: at },
      });
      const row = await this.prismaContext.client.floorPlan.update({
        where: { id: id.value },
        data: { isActive: true, updatedAt: at },
      });
      return FloorPlanPrismaMapper.toDomain(row);
    });
  }

  async softDeleteAllForBranch(branchId: BranchId, at: Date): Promise<void> {
    await this.prismaContext.client.floorPlan.updateMany({
      where: { branchId: branchId.value, deletedAt: null },
      data: { deletedAt: at, updatedAt: at },
    });
  }
}
