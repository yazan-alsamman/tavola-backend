import { ListRestaurantsUseCase } from './list-restaurants.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';

describe('ListRestaurantsUseCase', () => {
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

  async function seedRestaurants(repository: InMemoryRestaurantRepository, count: number) {
    const createUseCase = new CreateRestaurantUseCase(
      repository,
      new InMemoryRestaurantSettingsRepository(),
      new FixedClock(fixedNow),
      new UuidGenerator(),
      new CollectingEventPublisher(),
      new ImmediateUnitOfWork(),
    );
    for (let i = 0; i < count; i += 1) {
      await createUseCase.execute({
        actor: baseActor(),
        name: `Restaurant ${i}`,
        description: null,
        cuisineType: null,
        priceLevel: null,
      });
    }
  }

  it('returns a paginated page of restaurants with the correct total', async () => {
    const repository = new InMemoryRestaurantRepository();
    await seedRestaurants(repository, 3);
    const useCase = new ListRestaurantsUseCase(repository);

    const result = await useCase.execute({ actor: baseActor(), page: 1, limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(2);
  });

  it('returns an empty page when there are no restaurants', async () => {
    const repository = new InMemoryRestaurantRepository();
    const useCase = new ListRestaurantsUseCase(repository);

    const result = await useCase.execute({ actor: baseActor(), page: 1, limit: 20 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});
