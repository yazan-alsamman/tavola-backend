import { ListMyReviewsUseCase } from './list-my-reviews.use-case';
import { Review } from '../../domain/entities/review.entity';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { InMemoryReviewRepository } from '../../../../../test/reviews/support/in-memory-review.repository';
import { InMemoryReviewImageRepository } from '../../../../../test/reviews/support/in-memory-review-image.repository';
import { InMemoryRestaurantReplyRepository } from '../../../../../test/reviews/support/in-memory-restaurant-reply.repository';
import { InMemoryFileRepository } from '../../../../../test/restaurants/support/in-memory-file-repository';
import { FakeStoragePort } from '../../../../../test/restaurants/support/fake-storage-port';
import { InMemoryUserRepository } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { ReviewResultAssembler } from '../services/review-result-assembler.service';
import { FIXED_NOW, testUser } from '../../../../../test/reviews/support/review-test-fixtures';

describe('ListMyReviewsUseCase', () => {
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const userId = '22222222-2222-4222-8222-222222222222';
  const otherUserId = '22222222-2222-4222-8222-222222222299';

  function customerActor(id: string) {
    return {
      actorType: AccessTokenActorType.User as const,
      userId: id,
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
    };
  }

  async function build() {
    const reviewRepository = new InMemoryReviewRepository();
    const userRepository = new InMemoryUserRepository();
    const reviewImageRepository = new InMemoryReviewImageRepository();
    const restaurantReplyRepository = new InMemoryRestaurantReplyRepository();
    const fileRepository = new InMemoryFileRepository();
    const storagePort = new FakeStoragePort();

    await userRepository.save(testUser({ id: userId, username: 'jane_doe' }));

    const resultAssembler = new ReviewResultAssembler(
      userRepository,
      reviewImageRepository,
      restaurantReplyRepository,
      fileRepository,
      storagePort,
    );

    const useCase = new ListMyReviewsUseCase(reviewRepository, resultAssembler);
    return { useCase, reviewRepository };
  }

  it("lists only the caller's own reviews", async () => {
    const { useCase, reviewRepository } = await build();
    reviewRepository.seed(
      Review.create({
        id: '11111111-1111-4111-8111-111111111111',
        userId,
        restaurantId,
        reservationId: '44444444-4444-4444-8444-444444444441',
        rating: 5,
        comment: null,
        now: FIXED_NOW,
      }),
    );
    reviewRepository.seed(
      Review.create({
        id: '11111111-1111-4111-8111-111111111112',
        userId: otherUserId,
        restaurantId,
        reservationId: '44444444-4444-4444-8444-444444444442',
        rating: 3,
        comment: null,
        now: FIXED_NOW,
      }),
    );

    const result = await useCase.execute({ actor: customerActor(userId), page: 1, limit: 20 });
    expect(result.total).toBe(1);
    expect(result.items[0].rating).toBe(5);
  });

  it('returns an empty page when the caller has no reviews', async () => {
    const { useCase } = await build();
    const result = await useCase.execute({ actor: customerActor(userId), page: 1, limit: 20 });
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });
});
