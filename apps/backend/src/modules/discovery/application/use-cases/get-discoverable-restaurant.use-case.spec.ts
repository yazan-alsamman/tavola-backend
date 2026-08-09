import { GetDiscoverableRestaurantUseCase } from './get-discoverable-restaurant.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { ListWorkingHoursByRestaurantIdsUseCase } from '@modules/restaurants/application/use-cases/list-working-hours-by-restaurant-ids.use-case';
import { WorkingHours } from '@modules/restaurants/domain/entities/working-hours.entity';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { FakeDiscoveryReader } from '../../../../../test/discovery/support/fake-discovery-reader';
import { InMemoryWorkingHoursRepository } from '../../../../../test/restaurants/support/in-memory-working-hours.repository';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';

const restaurantId = '11111111-1111-4111-8111-111111111111';

function restaurant(): RestaurantResult {
  return {
    restaurantId,
    name: 'The Old Mill',
    slug: 'the-old-mill',
    logoId: null,
    coverImageId: null,
    description: 'Cozy spot.',
    cuisineType: 'Italian',
    averageRating: 4.5,
    priceLevel: 2,
    status: 'Active',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function buildUseCase(reader: FakeDiscoveryReader) {
  const workingHoursRepository = new InMemoryWorkingHoursRepository();
  const listWorkingHoursByRestaurantIdsUseCase = new ListWorkingHoursByRestaurantIdsUseCase(
    workingHoursRepository,
  );
  return {
    useCase: new GetDiscoverableRestaurantUseCase(reader, listWorkingHoursByRestaurantIdsUseCase),
    workingHoursRepository,
  };
}

describe('GetDiscoverableRestaurantUseCase', () => {
  it('returns a discoverable restaurant by id, from any organization', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant()];

    const { useCase } = buildUseCase(reader);
    const result = await useCase.execute({ restaurantId });
    expect(result.name).toBe('The Old Mill');
  });

  it('404s for an unknown restaurant id', async () => {
    const reader = new FakeDiscoveryReader();
    const { useCase } = buildUseCase(reader);
    await expect(useCase.execute({ restaurantId })).rejects.toBeInstanceOf(
      RestaurantNotFoundException,
    );
  });

  it('includes workingHours from the Restaurant-level default schedule (Public Working Hours)', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant()];

    const { useCase, workingHoursRepository } = buildUseCase(reader);
    await workingHoursRepository.replaceAllForRestaurant(RestaurantId.create(restaurantId), [
      WorkingHours.create({
        id: '33333333-3333-4333-8333-333333333331',
        restaurantId,
        dayOfWeek: 2,
        openingTime: '09:00',
        closingTime: '17:00',
        breakStartTime: '12:00',
        breakEndTime: '13:00',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ]);

    const result = await useCase.execute({ restaurantId });
    expect(result.workingHours).toEqual([
      {
        dayOfWeek: 2,
        openingTime: '09:00',
        closingTime: '17:00',
        breakStartTime: '12:00',
        breakEndTime: '13:00',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]);
  });

  it('defaults workingHours to an empty array when none is configured', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant()];

    const { useCase } = buildUseCase(reader);
    const result = await useCase.execute({ restaurantId });
    expect(result.workingHours).toEqual([]);
  });
});
