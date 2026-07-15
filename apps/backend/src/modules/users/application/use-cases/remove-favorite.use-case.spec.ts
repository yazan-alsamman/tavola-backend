import { RemoveFavoriteUseCase } from './remove-favorite.use-case';
import { FavoriteRestaurant } from '../../domain/entities/favorite-restaurant.entity';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingAuditLogWriter,
  FixedClock,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryFavoriteRestaurantRepository } from '../../../../../test/users/support/in-memory-favorites.dependencies';

describe('RemoveFavoriteUseCase', () => {
  const fixedNow = new Date('2026-07-14T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '55555555-5555-4555-8555-555555555555';
  const restaurantId = '22222222-2222-4222-8222-222222222222';
  const favoriteId = '33333333-3333-4333-8333-333333333333';

  function baseActor(overrides?: { userId?: string }) {
    return {
      userId: overrides?.userId ?? userId,
      sessionId: '44444444-4444-4444-8444-444444444444',
      sessionVersion: 1,
      tokenFamilyId: '66666666-6666-4666-8666-666666666666',
      actorType: AccessTokenActorType.User as const,
    };
  }

  function createUseCase() {
    const favoriteRepository = new InMemoryFavoriteRestaurantRepository();
    const auditLogWriter = new CollectingAuditLogWriter();
    const useCase = new RemoveFavoriteUseCase(
      favoriteRepository,
      new FixedClock(fixedNow),
      auditLogWriter,
    );
    return { useCase, favoriteRepository, auditLogWriter };
  }

  function seedFavorite(repository: InMemoryFavoriteRestaurantRepository, owner: string): void {
    repository.seed(
      FavoriteRestaurant.create({
        id: favoriteId,
        userId: owner,
        restaurantId,
        createdAt: fixedNow,
      }),
    );
  }

  it('removes an existing favorite', async () => {
    const { useCase, favoriteRepository } = createUseCase();
    seedFavorite(favoriteRepository, userId);

    await useCase.execute({ actor: baseActor(), restaurantId, ipAddress: null });

    expect(favoriteRepository.snapshot()).toHaveLength(0);
  });

  it('is idempotent: removing a favorite that does not exist is a silent no-op', async () => {
    const { useCase, favoriteRepository } = createUseCase();

    await expect(
      useCase.execute({ actor: baseActor(), restaurantId, ipAddress: null }),
    ).resolves.toBeUndefined();
    expect(favoriteRepository.snapshot()).toHaveLength(0);
  });

  it('one user cannot remove another user favorite', async () => {
    const { useCase, favoriteRepository } = createUseCase();
    seedFavorite(favoriteRepository, otherUserId);

    await useCase.execute({ actor: baseActor({ userId }), restaurantId, ipAddress: null });

    // The other user's favorite must remain untouched.
    expect(favoriteRepository.snapshot()).toHaveLength(1);
    expect(favoriteRepository.snapshot()[0].userId).toBe(otherUserId);
  });

  it('writes exactly one audit log entry describing the removal', async () => {
    const { useCase, favoriteRepository, auditLogWriter } = createUseCase();
    seedFavorite(favoriteRepository, userId);

    await useCase.execute({
      actor: baseActor(),
      restaurantId,
      ipAddress: '203.0.113.5',
      correlationId: 'corr-1',
    });

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: userId,
      actorType: 'User',
      action: 'user.favorite.removed',
      targetType: 'Restaurant',
      targetId: restaurantId,
      organizationId: null,
      correlationId: 'corr-1',
      ipAddress: '203.0.113.5',
    });
  });
});
