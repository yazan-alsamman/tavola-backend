import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { BranchId, FloorPlanId, TableId } from '@shared/domain/value-objects/identifiers.vo';
import { Table } from '../../domain/entities/table.entity';
import { TableStatus } from '../../domain/enums/table.enums';
import { TableListPage, TableRepository } from '../../domain/repositories/table.repository';
import { TablePrismaMapper } from './table.prisma-mapper';

/**
 * `Table` is NOT in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (no
 * direct `organizationId` column), so queries here run through the
 * tenant-scoped `PrismaContext` client as a verified no-op passthrough -
 * exactly like `PrismaBranchRepository`. This repository provides NO tenant
 * isolation by itself; see this interface's own doc comment for the flat-route
 * `findById` caveat.
 */
@Injectable()
export class PrismaTableRepository implements TableRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findById(id: TableId): Promise<Table | null> {
    const row = await this.prismaContext.client.table.findFirst({
      where: { id: id.value, deletedAt: null },
    });
    return row ? TablePrismaMapper.toDomain(row) : null;
  }

  async findByIdAndBranchId(id: TableId, branchId: BranchId): Promise<Table | null> {
    const row = await this.prismaContext.client.table.findFirst({
      where: { id: id.value, branchId: branchId.value, deletedAt: null },
    });
    return row ? TablePrismaMapper.toDomain(row) : null;
  }

  async findManyByBranchId(
    branchId: BranchId,
    page: number,
    limit: number,
  ): Promise<TableListPage> {
    const [rows, total] = await Promise.all([
      this.prismaContext.client.table.findMany({
        where: { branchId: branchId.value, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.table.count({
        where: { branchId: branchId.value, deletedAt: null },
      }),
    ]);

    return { items: rows.map(TablePrismaMapper.toDomain), total };
  }

  async findManyByFloorPlanId(
    floorPlanId: FloorPlanId,
    page: number,
    limit: number,
  ): Promise<TableListPage> {
    const [rows, total] = await Promise.all([
      this.prismaContext.client.table.findMany({
        where: { floorPlanId: floorPlanId.value, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.table.count({
        where: { floorPlanId: floorPlanId.value, deletedAt: null },
      }),
    ]);

    return { items: rows.map(TablePrismaMapper.toDomain), total };
  }

  async findManyAvailableByBranchIdAndMinCapacity(
    branchId: BranchId,
    minCapacity: number,
  ): Promise<Table[]> {
    const rows = await this.prismaContext.client.table.findMany({
      where: {
        branchId: branchId.value,
        deletedAt: null,
        status: TableStatus.Available,
        capacity: { gte: minCapacity },
      },
      orderBy: { tableNumber: 'asc' },
    });
    return rows.map(TablePrismaMapper.toDomain);
  }

  async existsByBranchIdAndTableNumber(
    branchId: BranchId,
    tableNumber: string,
    excludeId?: TableId,
  ): Promise<boolean> {
    const count = await this.prismaContext.client.table.count({
      where: {
        branchId: branchId.value,
        tableNumber,
        ...(excludeId ? { NOT: { id: excludeId.value } } : {}),
      },
    });
    return count > 0;
  }

  async save(table: Table): Promise<void> {
    const data = TablePrismaMapper.toPersistence(table);
    await this.prismaContext.client.table.upsert({
      where: { id: data.id },
      create: data,
      update: {
        floorPlanId: data.floorPlanId,
        tableNumber: data.tableNumber,
        capacity: data.capacity,
        floor: data.floor,
        positionX: data.positionX,
        positionY: data.positionY,
        width: data.width,
        height: data.height,
        rotation: data.rotation,
        shape: data.shape,
        layer: data.layer,
        indoor: data.indoor,
        vip: data.vip,
        smoking: data.smoking,
        status: data.status,
        mergeGroupId: data.mergeGroupId,
        updatedAt: data.updatedAt,
        deletedAt: data.deletedAt,
      },
    });
  }

  async softDeleteAllForBranch(branchId: BranchId, at: Date): Promise<void> {
    await this.prismaContext.client.table.updateMany({
      where: { branchId: branchId.value, deletedAt: null },
      data: { deletedAt: at, updatedAt: at },
    });
  }
}
