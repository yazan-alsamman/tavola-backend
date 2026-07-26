import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { BranchId, FloorPlanId, TableId } from '@shared/domain/value-objects/identifiers.vo';
import { Table } from '../../domain/entities/table.entity';
import { TableStatus } from '../../domain/enums/table.enums';
import { TableMergeService } from '../../domain/services/table-merge.service';
import { TableTopologyLockService } from '../../domain/services/table-topology-lock.service';
import { TableListPage, TableRepository } from '../../domain/repositories/table.repository';
import { TablePrismaMapper } from './table.prisma-mapper';

type TablePersistence = ReturnType<typeof TablePrismaMapper.toPersistence>;

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

  /**
   * Phase 6 (Merge/Split Tables, ADR-026 decision #4/#14): loads every
   * `Available`, non-soft-deleted table in the branch, then filters by
   * *effective* capacity - a plain `capacity` comparison for unmerged
   * tables, and `TableMergeService.computeEffectiveCapacity` over the full
   * merge-group membership (loaded via `findManyByMergeGroupId`, which
   * includes `Merged` secondaries) for a merge primary. No extra exclusion
   * is needed for secondaries - they are never `Available`, so the initial
   * query already omits them.
   */
  async findManyAvailableByBranchIdAndMinCapacity(
    branchId: BranchId,
    minCapacity: number,
  ): Promise<Table[]> {
    const rows = await this.prismaContext.client.table.findMany({
      where: {
        branchId: branchId.value,
        deletedAt: null,
        status: TableStatus.Available,
      },
      orderBy: { tableNumber: 'asc' },
    });
    const candidates = rows.map(TablePrismaMapper.toDomain);

    // Batches every merge-group membership lookup this loop needs into ONE
    // query (instead of one `findManyByMergeGroupId` round-trip per merged
    // candidate) - this method is on the hot path for both availability
    // search and waitlist promotion.
    const mergeGroupIds = [
      ...new Set(
        candidates
          .filter((table) => table.mergeGroupId !== null)
          .map((table) => table.mergeGroupId as string),
      ),
    ];
    const membersByGroup = new Map<string, Table[]>();
    if (mergeGroupIds.length > 0) {
      const memberRows = await this.prismaContext.client.table.findMany({
        where: { mergeGroupId: { in: mergeGroupIds }, deletedAt: null },
      });
      for (const row of memberRows) {
        const member = TablePrismaMapper.toDomain(row);
        const key = member.mergeGroupId as string;
        const members = membersByGroup.get(key);
        if (members) {
          members.push(member);
        } else {
          membersByGroup.set(key, [member]);
        }
      }
    }

    const eligible: Table[] = [];
    for (const table of candidates) {
      if (table.mergeGroupId === null) {
        if (table.capacity >= minCapacity) {
          eligible.push(table);
        }
        continue;
      }
      const members = membersByGroup.get(table.mergeGroupId) ?? [];
      if (TableMergeService.computeEffectiveCapacity(members) >= minCapacity) {
        eligible.push(table);
      }
    }
    return eligible;
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
        isMergePrimary: data.isMergePrimary,
        updatedAt: data.updatedAt,
        deletedAt: data.deletedAt,
      },
    });
  }

  async findManyByIds(ids: TableId[]): Promise<Table[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.prismaContext.client.table.findMany({
      where: { id: { in: ids.map((id) => id.value) }, deletedAt: null },
    });
    return rows.map(TablePrismaMapper.toDomain);
  }

  async findManyByMergeGroupId(mergeGroupId: string): Promise<Table[]> {
    const rows = await this.prismaContext.client.table.findMany({
      where: { mergeGroupId, deletedAt: null },
    });
    return rows.map(TablePrismaMapper.toDomain);
  }

  async acquireTopologyLocks(tableIds: string[]): Promise<void> {
    for (const lockKey of TableTopologyLockService.deriveLockKeysInOrder(tableIds)) {
      // `$executeRaw`, not `$queryRaw`: `pg_advisory_xact_lock` returns
      // `void` (see `PrismaReservationRepository.acquireAdvisoryLock`'s own
      // comment for the same reasoning). Sequential, not `Promise.all` -
      // acquisition order must match the sorted key order (ADR-026 decision
      // #7's deadlock-avoidance requirement).
      await this.prismaContext.client
        .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    }
  }

  async saveMany(tables: Table[]): Promise<void> {
    if (tables.length === 0) {
      return;
    }
    if (tables.length === 1) {
      await this.save(tables[0]);
      return;
    }

    // Merge/Split always pass every affected table through in one call, and
    // most of them end up with IDENTICAL field values (e.g. every Merge
    // secondary transitions to the same mergeGroupId/status/updatedAt) -
    // grouping by resulting value and issuing one `updateMany` per distinct
    // group cuts N round-trips down to the number of distinct groups
    // (typically 1-2), instead of one upsert per row. Both callers
    // (MergeTablesUseCase/SplitTablesUseCase) only ever pass already-existing
    // rows (loaded via findManyByIds/findManyByMergeGroupId), so `updateMany`
    // (update-only, no insert) is safe here - unlike `save`, this method is
    // never used to persist a newly-created Table.
    const groups = new Map<string, { ids: string[]; data: Omit<TablePersistence, 'id'> }>();
    for (const table of tables) {
      const { id, ...data } = TablePrismaMapper.toPersistence(table);
      const key = JSON.stringify(data);
      const group = groups.get(key);
      if (group) {
        group.ids.push(id);
      } else {
        groups.set(key, { ids: [id], data });
      }
    }

    for (const { ids, data } of groups.values()) {
      await this.prismaContext.client.table.updateMany({
        where: { id: { in: ids } },
        data,
      });
    }
  }

  async softDeleteAllForBranch(branchId: BranchId, at: Date): Promise<void> {
    await this.prismaContext.client.table.updateMany({
      where: { branchId: branchId.value, deletedAt: null },
      data: { deletedAt: at, updatedAt: at },
    });
  }
}
