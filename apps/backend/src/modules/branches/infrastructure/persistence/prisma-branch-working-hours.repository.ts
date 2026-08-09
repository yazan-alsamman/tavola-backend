import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { BranchWorkingHours } from '../../domain/entities/branch-working-hours.entity';
import { BranchWorkingHoursRepository } from '../../domain/repositories/branch-working-hours.repository';
import { BranchWorkingHoursPrismaMapper } from './branch-working-hours.prisma-mapper';

/**
 * `BranchWorkingHours` is NOT in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (no direct `organizationId` column), so
 * queries here run through the tenant-scoped `PrismaContext` client as a
 * verified no-op passthrough - exactly like `PrismaWorkingHoursRepository`.
 * This repository provides NO tenant isolation by itself. Every consuming use
 * case MUST resolve the parent Restaurant via `RestaurantRepository`, then the
 * parent Branch via `BranchRepository`, and only call these methods after
 * both succeed - see `GetBranchWorkingHoursUseCase`/`UpdateBranchWorkingHoursUseCase`.
 */
@Injectable()
export class PrismaBranchWorkingHoursRepository implements BranchWorkingHoursRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findAllByBranchId(branchId: BranchId): Promise<BranchWorkingHours[]> {
    const rows = await this.prismaContext.client.branchWorkingHours.findMany({
      where: { branchId: branchId.value },
      orderBy: { dayOfWeek: 'asc' },
    });
    return rows.map(BranchWorkingHoursPrismaMapper.toDomain);
  }

  /**
   * One batched `IN (...)` query for every requested branch, not one query
   * per branch - the caller (`ListBranchWorkingHoursByBranchIdsUseCase`)
   * groups the flat result by `branchId` itself.
   */
  async findAllByBranchIds(branchIds: BranchId[]): Promise<BranchWorkingHours[]> {
    if (branchIds.length === 0) {
      return [];
    }
    const rows = await this.prismaContext.client.branchWorkingHours.findMany({
      where: { branchId: { in: branchIds.map((id) => id.value) } },
      orderBy: [{ branchId: 'asc' }, { dayOfWeek: 'asc' }],
    });
    return rows.map(BranchWorkingHoursPrismaMapper.toDomain);
  }

  /**
   * Full-replace of the entire week for one branch: deletes every existing
   * row for `branchId` and inserts `entries` in a single transaction, so a
   * caller never observes a partially-replaced week.
   */
  async replaceAllForBranch(branchId: BranchId, entries: BranchWorkingHours[]): Promise<void> {
    await this.prismaContext.runInTransaction(async () => {
      await this.prismaContext.client.branchWorkingHours.deleteMany({
        where: { branchId: branchId.value },
      });
      if (entries.length > 0) {
        await this.prismaContext.client.branchWorkingHours.createMany({
          data: entries.map((entry) => BranchWorkingHoursPrismaMapper.toPersistence(entry)),
        });
      }
    });
  }
}
