import { GetRestaurantSettingsUseCase } from './get-restaurant-settings.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';

describe('GetRestaurantSettingsUseCase', () => {
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

  it('returns the default settings for a freshly created restaurant', async () => {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    const useCase = new GetRestaurantSettingsUseCase(
      restaurantRepository,
      restaurantSettingsRepository,
    );

    const result = await useCase.execute({ actor: baseActor(), restaurantId });

    expect(result).toMatchObject({
      restaurantId,
      reservationIntervalMinutes: 30,
      maxGuestsPerReservation: 20,
      cancellationWindowMinutes: 60,
      pendingReservationTimeoutMinutes: 15,
      defaultReservationDurationMinutes: 90,
      autoApproval: false,
      timezone: 'UTC',
      defaultCurrency: null,
    });
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const useCase = new GetRestaurantSettingsUseCase(
      restaurantRepository,
      restaurantSettingsRepository,
    );

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
