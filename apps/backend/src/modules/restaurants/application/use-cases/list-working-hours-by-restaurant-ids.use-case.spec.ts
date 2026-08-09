import { ListWorkingHoursByRestaurantIdsUseCase } from './list-working-hours-by-restaurant-ids.use-case';
import { WorkingHours } from '../../domain/entities/working-hours.entity';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { InMemoryWorkingHoursRepository } from '../../../../../test/restaurants/support/in-memory-working-hours.repository';

const restaurantIdA = '11111111-1111-4111-8111-111111111111';
const restaurantIdB = '11111111-1111-4111-8111-111111111112';

function entry(restaurantId: string, dayOfWeek: number, id: string): WorkingHours {
  return WorkingHours.create({
    id,
    restaurantId,
    dayOfWeek,
    openingTime: '09:00',
    closingTime: '17:00',
    breakStartTime: null,
    breakEndTime: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  });
}

describe('ListWorkingHoursByRestaurantIdsUseCase', () => {
  it('returns an empty Map for an empty input, without querying the repository', async () => {
    const repository = new InMemoryWorkingHoursRepository();
    const useCase = new ListWorkingHoursByRestaurantIdsUseCase(repository);

    const result = await useCase.execute({ restaurantIds: [] });
    expect(result.size).toBe(0);
  });

  it('groups entries by restaurantId, sorted by dayOfWeek, in one batched call', async () => {
    const repository = new InMemoryWorkingHoursRepository();
    await repository.replaceAllForRestaurant(RestaurantId.create(restaurantIdA), [
      entry(restaurantIdA, 3, '33333333-3333-4333-8333-333333333331'),
      entry(restaurantIdA, 1, '33333333-3333-4333-8333-333333333332'),
    ]);
    await repository.replaceAllForRestaurant(RestaurantId.create(restaurantIdB), [
      entry(restaurantIdB, 5, '33333333-3333-4333-8333-333333333333'),
    ]);

    const useCase = new ListWorkingHoursByRestaurantIdsUseCase(repository);
    const result = await useCase.execute({ restaurantIds: [restaurantIdA, restaurantIdB] });

    expect(result.get(restaurantIdA)?.map((e) => e.dayOfWeek)).toEqual([1, 3]);
    expect(result.get(restaurantIdB)?.map((e) => e.dayOfWeek)).toEqual([5]);
  });

  it('omits a restaurantId with no configured entries from the Map', async () => {
    const repository = new InMemoryWorkingHoursRepository();
    const useCase = new ListWorkingHoursByRestaurantIdsUseCase(repository);

    const result = await useCase.execute({ restaurantIds: [restaurantIdA] });
    expect(result.has(restaurantIdA)).toBe(false);
  });
});
