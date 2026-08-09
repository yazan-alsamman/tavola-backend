import { ListBranchWorkingHoursByBranchIdsUseCase } from './list-branch-working-hours-by-branch-ids.use-case';
import { BranchWorkingHours } from '../../domain/entities/branch-working-hours.entity';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { InMemoryBranchWorkingHoursRepository } from '../../../../../test/branches/support/in-memory-branch-working-hours.repository';

const branchIdA = '22222222-2222-4222-8222-222222222221';
const branchIdB = '22222222-2222-4222-8222-222222222222';

function entry(branchId: string, dayOfWeek: number, id: string): BranchWorkingHours {
  return BranchWorkingHours.create({
    id,
    branchId,
    dayOfWeek,
    openingTime: '10:00',
    closingTime: '22:00',
    breakStartTime: null,
    breakEndTime: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  });
}

describe('ListBranchWorkingHoursByBranchIdsUseCase', () => {
  it('returns an empty Map for an empty input, without querying the repository', async () => {
    const repository = new InMemoryBranchWorkingHoursRepository();
    const useCase = new ListBranchWorkingHoursByBranchIdsUseCase(repository);

    const result = await useCase.execute({ branchIds: [] });
    expect(result.size).toBe(0);
  });

  it('groups entries by branchId, sorted by dayOfWeek, in one batched call', async () => {
    const repository = new InMemoryBranchWorkingHoursRepository();
    await repository.replaceAllForBranch(BranchId.create(branchIdA), [
      entry(branchIdA, 6, '44444444-4444-4444-8444-444444444441'),
      entry(branchIdA, 0, '44444444-4444-4444-8444-444444444442'),
    ]);
    await repository.replaceAllForBranch(BranchId.create(branchIdB), [
      entry(branchIdB, 2, '44444444-4444-4444-8444-444444444443'),
    ]);

    const useCase = new ListBranchWorkingHoursByBranchIdsUseCase(repository);
    const result = await useCase.execute({ branchIds: [branchIdA, branchIdB] });

    expect(result.get(branchIdA)?.map((e) => e.dayOfWeek)).toEqual([0, 6]);
    expect(result.get(branchIdB)?.map((e) => e.dayOfWeek)).toEqual([2]);
  });

  it('omits a branchId with no configured override from the Map', async () => {
    const repository = new InMemoryBranchWorkingHoursRepository();
    const useCase = new ListBranchWorkingHoursByBranchIdsUseCase(repository);

    const result = await useCase.execute({ branchIds: [branchIdA] });
    expect(result.has(branchIdA)).toBe(false);
  });
});
