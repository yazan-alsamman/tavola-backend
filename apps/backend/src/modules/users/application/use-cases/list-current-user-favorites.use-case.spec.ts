import { ListCurrentUserFavoritesUseCase } from './list-current-user-favorites.use-case';
import { FavoriteRestaurant } from '../../domain/entities/favorite-restaurant.entity';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  InMemoryFavoriteRestaurantRepository,
  InMemoryRestaurantDirectoryReader,
} from '../../../../../test/users/support/in-memory-favorites.dependencies';

describe('ListCurrentUserFavoritesUseCase', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '55555555-5555-4555-8555-555555555555';

  function baseActor() {
    return {
      userId,
      sessionId: '44444444-4444-4444-8444-444444444444',
      sessionVersion: 1,
      tokenFamilyId: '66666666-6666-4666-8666-666666666666',
      actorType: AccessTokenActorType.User as const,
    };
  }

  function createUseCase() {
    const favoriteRepository = new InMemoryFavoriteRestaurantRepository();
    const restaurantDirectoryReader = new InMemoryRestaurantDirectoryReader();
    const useCase = new ListCurrentUserFavoritesUseCase(
      favoriteRepository,
      restaurantDirectoryReader,
    );
    return { useCase, favoriteRepository, restaurantDirectoryReader };
  }

  function favorite(id: string, owner: string, restaurantId: string, at: Date): FavoriteRestaurant {
    return FavoriteRestaurant.create({ id, userId: owner, restaurantId, createdAt: at });
  }

  it('returns an empty list when the user has no favorites', async () => {
    const { useCase } = createUseCase();

    const result = await useCase.execute({ actor: baseActor(), page: 1, limit: 20 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns favorites ordered most-recently-favorited first', async () => {
    const { useCase, favoriteRepository, restaurantDirectoryReader } = createUseCase();
    restaurantDirectoryReader.seed({
      id: 'r1',
      name: 'Older',
      slug: 'older',
      cuisineType: null,
      priceLevel: null,
      averageRating: null,
      status: 'Active',
    });
    restaurantDirectoryReader.seed({
      id: 'r2',
      name: 'Newer',
      slug: 'newer',
      cuisineType: null,
      priceLevel: null,
      averageRating: null,
      status: 'Active',
    });
    favoriteRepository.seed(favorite('f1', userId, 'r1', new Date('2026-07-01T00:00:00.000Z')));
    favoriteRepository.seed(favorite('f2', userId, 'r2', new Date('2026-07-10T00:00:00.000Z')));

    const result = await useCase.execute({ actor: baseActor(), page: 1, limit: 20 });

    expect(result.items.map((item) => item.restaurantId)).toEqual(['r2', 'r1']);
    expect(result.total).toBe(2);
  });

  it('only returns the current user own favorites', async () => {
    const { useCase, favoriteRepository, restaurantDirectoryReader } = createUseCase();
    restaurantDirectoryReader.seed({
      id: 'r1',
      name: 'Mine',
      slug: 'mine',
      cuisineType: null,
      priceLevel: null,
      averageRating: null,
      status: 'Active',
    });
    favoriteRepository.seed(favorite('f1', userId, 'r1', new Date('2026-07-01T00:00:00.000Z')));
    favoriteRepository.seed(
      favorite('f2', otherUserId, 'r1', new Date('2026-07-01T00:00:00.000Z')),
    );

    const result = await useCase.execute({ actor: baseActor(), page: 1, limit: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('excludes favorites whose restaurant no longer exists (soft-deleted), without touching total', async () => {
    const { useCase, favoriteRepository, restaurantDirectoryReader } = createUseCase();
    restaurantDirectoryReader.seed({
      id: 'r1',
      name: 'Still here',
      slug: 'still-here',
      cuisineType: null,
      priceLevel: null,
      averageRating: null,
      status: 'Active',
    });
    // r2 is favorited but never seeded in the reader - simulates a
    // since-soft-deleted restaurant, which the reader never returns.
    favoriteRepository.seed(favorite('f1', userId, 'r1', new Date('2026-07-01T00:00:00.000Z')));
    favoriteRepository.seed(favorite('f2', userId, 'r2', new Date('2026-07-02T00:00:00.000Z')));

    const result = await useCase.execute({ actor: baseActor(), page: 1, limit: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].restaurantId).toBe('r1');
    expect(result.total).toBe(2); // raw Favorite count, documented limitation
  });

  it('paginates using page/limit', async () => {
    const { useCase, favoriteRepository, restaurantDirectoryReader } = createUseCase();
    for (let index = 0; index < 3; index += 1) {
      const restaurantId = `r${index}`;
      restaurantDirectoryReader.seed({
        id: restaurantId,
        name: restaurantId,
        slug: restaurantId,
        cuisineType: null,
        priceLevel: null,
        averageRating: null,
        status: 'Active',
      });
      favoriteRepository.seed(
        favorite(`f${index}`, userId, restaurantId, new Date(2026, 6, index + 1)),
      );
    }

    const firstPage = await useCase.execute({ actor: baseActor(), page: 1, limit: 2 });
    const secondPage = await useCase.execute({ actor: baseActor(), page: 2, limit: 2 });

    expect(firstPage.items).toHaveLength(2);
    expect(secondPage.items).toHaveLength(1);
    expect(firstPage.total).toBe(3);
    expect(secondPage.total).toBe(3);
  });
});
