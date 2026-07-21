import { GetWorkingHoursUseCase } from './get-working-hours.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { WorkingHours } from '../../domain/entities/working-hours.entity';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryWorkingHoursRepository } from '../../../../../test/restaurants/support/in-memory-working-hours.repository';

describe('GetWorkingHoursUseCase', () => {
  const fixedNow = new Date('2026-07-16T12:00:00.000Z');

  function baseActor() {
    return {
      actorType: AccessTokenActorType.OrganizationMember as const,
      userId: 'user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      organizationId: '33333333-3333-4333-8333-333333333333',
      orgRole: 'Owner',
      permissionsVersion: 1,
    };
  }

  async function seedRestaurant(
    restaurantRepository: InMemoryRestaurantRepository,
    restaurantSettingsRepository: InMemoryRestaurantSettingsRepository,
  ): Promise<string> {
    const createUseCase = new CreateRestaurantUseCase(
      restaurantRepository,
      restaurantSettingsRepository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      new CollectingEventPublisher(),
      new ImmediateUnitOfWork(),
    );
    const result = await createUseCase.execute({
      actor: baseActor(),
      name: 'The Old Mill',
      description: null,
      cuisineType: null,
      priceLevel: null,
    });
    return result.restaurantId;
  }

  it('returns an empty entries array for a freshly created restaurant', async () => {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const workingHoursRepository = new InMemoryWorkingHoursRepository();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    const useCase = new GetWorkingHoursUseCase(restaurantRepository, workingHoursRepository);

    const result = await useCase.execute({ actor: baseActor(), restaurantId });

    expect(result).toEqual({ restaurantId, entries: [] });
  });

  it('returns entries sorted by dayOfWeek', async () => {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const workingHoursRepository = new InMemoryWorkingHoursRepository();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    await workingHoursRepository.replaceAllForRestaurant(RestaurantId.create(restaurantId), [
      WorkingHours.create({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        restaurantId,
        dayOfWeek: 5,
        openingTime: '09:00',
        closingTime: '22:00',
        breakStartTime: null,
        breakEndTime: null,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
      WorkingHours.create({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        restaurantId,
        dayOfWeek: 1,
        openingTime: '10:00',
        closingTime: '18:00',
        breakStartTime: null,
        breakEndTime: null,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
    ]);

    const useCase = new GetWorkingHoursUseCase(restaurantRepository, workingHoursRepository);
    const result = await useCase.execute({ actor: baseActor(), restaurantId });

    expect(result.entries.map((entry) => entry.dayOfWeek)).toEqual([1, 5]);
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const workingHoursRepository = new InMemoryWorkingHoursRepository();
    const useCase = new GetWorkingHoursUseCase(restaurantRepository, workingHoursRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
