import { BranchWorkingHours } from '../../domain/entities/branch-working-hours.entity';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { InMemoryBranchWorkingHoursRepository } from '../../../../../test/branches/support/in-memory-branch-working-hours.repository';
import { ListRestaurantWorkingHoursFromBranchesUseCase } from './list-restaurant-working-hours-from-branches.use-case';

const restaurantId = '11111111-1111-4111-8111-111111111111';
const otherRestaurantId = '11111111-1111-4111-8111-111111111112';
const firstBranchId = '22222222-2222-4222-8222-222222222221';
const secondBranchId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-11-13T00:00:00.000Z');

function hours(id: string, branchId: string, dayOfWeek: number, openingTime: string) {
  return BranchWorkingHours.create({
    id,
    branchId,
    dayOfWeek,
    openingTime,
    closingTime: '23:00',
    breakStartTime: null,
    breakEndTime: null,
    createdAt: now,
    updatedAt: now,
  });
}

describe('ListRestaurantWorkingHoursFromBranchesUseCase', () => {
  it("returns the oldest branch's hours per restaurant, ordered by weekday", async () => {
    const repository = new InMemoryBranchWorkingHoursRepository();
    repository.registerBranch(restaurantId, firstBranchId);
    repository.registerBranch(restaurantId, secondBranchId);
    await repository.replaceAllForBranch(BranchId.create(firstBranchId), [
      hours('33333333-3333-4333-8333-333333333332', firstBranchId, 5, '12:00'),
      hours('33333333-3333-4333-8333-333333333331', firstBranchId, 1, '10:00'),
    ]);
    await repository.replaceAllForBranch(BranchId.create(secondBranchId), [
      hours('33333333-3333-4333-8333-333333333333', secondBranchId, 1, '08:00'),
    ]);

    const result = await new ListRestaurantWorkingHoursFromBranchesUseCase(repository).execute({
      restaurantIds: [restaurantId, otherRestaurantId],
    });

    expect(result.get(restaurantId)?.map((entry) => [entry.dayOfWeek, entry.openingTime])).toEqual([
      [1, '10:00'],
      [5, '12:00'],
    ]);
    expect(result.has(otherRestaurantId)).toBe(false);
  });

  it('returns an empty map for no restaurants', async () => {
    const result = await new ListRestaurantWorkingHoursFromBranchesUseCase(
      new InMemoryBranchWorkingHoursRepository(),
    ).execute({ restaurantIds: [] });
    expect(result.size).toBe(0);
  });
});
