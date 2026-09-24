import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { FloorPlanAreaId, FloorPlanId } from '@shared/domain/value-objects/identifiers.vo';
import { FloorPlanArea } from '../../domain/entities/floor-plan-area.entity';
import { FloorPlanAreaRepository } from '../../domain/repositories/floor-plan-area.repository';
import { FloorPlanAreaPrismaMapper } from './floor-plan-area.prisma-mapper';

/**
 * ADR-040. `FloorPlanArea` is NOT in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (no direct `organizationId` column), so queries
 * here run through the tenant-scoped `PrismaContext` client as a verified
 * no-op passthrough - exactly like `PrismaFloorPlanRepository`. This repository
 * provides NO tenant isolation by itself: every consuming use case resolves
 * Restaurant -> Branch -> FloorPlan through their already-tenant-scoped
 * repositories first (`resolveFloorPlanScope`).
 */
@Injectable()
export class PrismaFloorPlanAreaRepository implements FloorPlanAreaRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findByIdAndFloorPlanId(
    id: FloorPlanAreaId,
    floorPlanId: FloorPlanId,
  ): Promise<FloorPlanArea | null> {
    const row = await this.prismaContext.client.floorPlanArea.findFirst({
      where: { id: id.value, floorPlanId: floorPlanId.value, deletedAt: null },
    });
    return row ? FloorPlanAreaPrismaMapper.toDomain(row) : null;
  }

  async findManyByFloorPlanId(floorPlanId: FloorPlanId): Promise<FloorPlanArea[]> {
    const rows = await this.prismaContext.client.floorPlanArea.findMany({
      where: { floorPlanId: floorPlanId.value, deletedAt: null },
      // The editor's tab order. `createdAt` breaks ties deterministically -
      // `sortOrder` carries no uniqueness constraint (see schema.prisma).
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(FloorPlanAreaPrismaMapper.toDomain);
  }

  async existsByFloorPlanIdAndName(
    floorPlanId: FloorPlanId,
    name: string,
    excludeId?: FloorPlanAreaId,
  ): Promise<boolean> {
    // `deletedAt: null` matches the partial unique index exactly - a
    // soft-deleted area releases its name for reuse (ADR-040 decision #6),
    // unlike `tables.table_number`, whose unique constraint is not partial.
    const count = await this.prismaContext.client.floorPlanArea.count({
      where: {
        floorPlanId: floorPlanId.value,
        name,
        deletedAt: null,
        ...(excludeId ? { NOT: { id: excludeId.value } } : {}),
      },
    });
    return count > 0;
  }

  async countAssignedTables(id: FloorPlanAreaId): Promise<number> {
    return this.prismaContext.client.table.count({
      where: { floorPlanAreaId: id.value, deletedAt: null },
    });
  }

  async save(area: FloorPlanArea): Promise<void> {
    const data = FloorPlanAreaPrismaMapper.toPersistence(area);
    await this.prismaContext.client.floorPlanArea.upsert({
      where: { id: data.id },
      create: data,
      update: {
        // `floorPlanId` is deliberately absent: an Area never migrates between
        // layouts (see `FloorPlanArea.updateProfile`).
        name: data.name,
        color: data.color,
        sortOrder: data.sortOrder,
        updatedAt: data.updatedAt,
        deletedAt: data.deletedAt,
      },
    });
  }
}
