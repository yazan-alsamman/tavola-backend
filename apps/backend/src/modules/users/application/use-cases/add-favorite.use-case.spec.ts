import { AddFavoriteUseCase } from './add-favorite.use-case';
import { RestaurantNotFoundException } from '../exceptions/restaurant-not-found.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingAuditLogWriter,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import {
  InMemoryFavoriteRestaurantRepository,
  InMemoryRestaurantDirectoryReader,
} from '../../../../../test/users/support/in-memory-favorites.dependencies';

describe('AddFavoriteUseCase', () => {
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
    const restaurantDirectoryReader = new InMemoryRestaurantDirectoryReader();
    const auditLogWriter = new CollectingAuditLogWriter();
    const useCase = new AddFavoriteUseCase(
      favoriteRepository,
      restaurantDirectoryReader,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([favoriteId]),
      auditLogWriter,
    );
    return { useCase, favoriteRepository, restaurantDirectoryReader, auditLogWriter };
  }

  function seedRestaurant(reader: InMemoryRestaurantDirectoryReader): void {
    reader.seed({
      id: restaurantId,
      name: 'Test Restaurant',
      slug: 'test-restaurant',
      cuisineType: 'Italian',
      priceLevel: 2,
      averageRating: 4.5,
      status: 'Active',
    });
  }

  it('adds a favorite for an existing restaurant', async () => {
    const { useCase, restaurantDirectoryReader, favoriteRepository } = createUseCase();
    seedRestaurant(restaurantDirectoryReader);

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      ipAddress: '203.0.113.5',
    });

    expect(result.restaurantId).toBe(restaurantId);
    expect(result.favoritedAt).toEqual(fixedNow);
    expect(favoriteRepository.snapshot()).toHaveLength(1);
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const { useCase } = createUseCase();

    await expect(
      useCase.execute({ actor: baseActor(), restaurantId, ipAddress: null }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('throws RestaurantNotFoundException for a soft-deleted restaurant', async () => {
    const { useCase, restaurantDirectoryReader } = createUseCase();
    seedRestaurant(restaurantDirectoryReader);
    restaurantDirectoryReader.remove(restaurantId); // simulates soft-delete (reader never returns it)

    await expect(
      useCase.execute({ actor: baseActor(), restaurantId, ipAddress: null }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('is idempotent: adding the same favorite twice does not create a duplicate', async () => {
    const favoriteRepository = new InMemoryFavoriteRestaurantRepository();
    const restaurantDirectoryReader = new InMemoryRestaurantDirectoryReader();
    const useCase = new AddFavoriteUseCase(
      favoriteRepository,
      restaurantDirectoryReader,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([favoriteId, '77777777-7777-4777-8777-777777777777']),
      new CollectingAuditLogWriter(),
    );
    seedRestaurant(restaurantDirectoryReader);

    await useCase.execute({ actor: baseActor(), restaurantId, ipAddress: null });
    await useCase.execute({ actor: baseActor(), restaurantId, ipAddress: null });

    expect(favoriteRepository.snapshot()).toHaveLength(1);
  });

  it('never trusts a restaurantId/userId other than the command inputs', async () => {
    const { useCase, restaurantDirectoryReader, favoriteRepository } = createUseCase();
    seedRestaurant(restaurantDirectoryReader);

    await useCase.execute({
      actor: baseActor({ userId: otherUserId }),
      restaurantId,
      ipAddress: null,
    });

    const saved = favoriteRepository.snapshot();
    expect(saved).toHaveLength(1);
    expect(saved[0].userId).toBe(otherUserId);
  });

  it('writes exactly one audit log entry describing the addition', async () => {
    const { useCase, restaurantDirectoryReader, auditLogWriter } = createUseCase();
    seedRestaurant(restaurantDirectoryReader);

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
      action: 'user.favorite.added',
      targetType: 'Restaurant',
      targetId: restaurantId,
      organizationId: null,
      correlationId: 'corr-1',
      ipAddress: '203.0.113.5',
    });
  });
});
