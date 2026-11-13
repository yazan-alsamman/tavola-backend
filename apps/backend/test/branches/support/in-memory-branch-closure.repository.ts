import { BranchClosure } from '@modules/branches/domain/entities/branch-closure.entity';
import { BranchClosureRepository } from '@modules/branches/domain/repositories/branch-closure.repository';

export class InMemoryBranchClosureRepository implements BranchClosureRepository {
  readonly rows = new Map<string, BranchClosure>();

  async findUpcoming(branchId: string, fromDate: string): Promise<BranchClosure[]> {
    return [...this.rows.values()]
      .filter((closure) => closure.branchId === branchId && closure.endDate >= fromDate)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  async findById(id: string, branchId: string): Promise<BranchClosure | null> {
    const closure = this.rows.get(id);
    return closure && closure.branchId === branchId ? closure : null;
  }

  async isClosedOn(branchId: string, date: string): Promise<boolean> {
    return [...this.rows.values()].some(
      (closure) => closure.branchId === branchId && closure.covers(date),
    );
  }

  async save(closure: BranchClosure): Promise<void> {
    this.rows.set(closure.closureId, closure);
  }

  async remove(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
