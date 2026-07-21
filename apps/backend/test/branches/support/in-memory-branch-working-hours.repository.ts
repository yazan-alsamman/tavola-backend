import { BranchWorkingHours } from '@modules/branches/domain/entities/branch-working-hours.entity';
import { BranchWorkingHoursRepository } from '@modules/branches/domain/repositories/branch-working-hours.repository';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryBranchWorkingHoursRepository implements BranchWorkingHoursRepository {
  private readonly rows = new Map<string, BranchWorkingHours[]>();

  async findAllByBranchId(branchId: BranchId): Promise<BranchWorkingHours[]> {
    return this.rows.get(branchId.value) ?? [];
  }

  async replaceAllForBranch(branchId: BranchId, entries: BranchWorkingHours[]): Promise<void> {
    this.rows.set(branchId.value, entries);
  }
}
