import { GetReviewUseCase } from './get-review.use-case';
import { Review } from '../../domain/entities/review.entity';
import { ReviewNotFoundException } from '../../domain/exceptions/review-not-found.exception';
import { InMemoryReviewRepository } from '../../../../../test/reviews/support/in-memory-review.repository';
import { InMemoryReviewImageRepository } from '../../../../../test/reviews/support/in-memory-review-image.repository';
import { InMemoryRestaurantReplyRepository } from '../../../../../test/reviews/support/in-memory-restaurant-reply.repository';
import { InMemoryFileRepository } from '../../../../../test/restaurants/support/in-memory-file-repository';
import { FakeStoragePort } from '../../../../../test/restaurants/support/fake-storage-port';
import { InMemoryUserRepository } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { ReviewResultAssembler } from '../services/review-result-assembler.service';
import { FIXED_NOW, testUser } from '../../../../../test/reviews/support/review-test-fixtures';

describe('GetReviewUseCase', () => {
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const reviewId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';

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

    const useCase = new GetReviewUseCase(reviewRepository, resultAssembler);
    return { useCase, reviewRepository };
  }

  it('returns a review by id, publicly', async () => {
    const { useCase, reviewRepository } = await build();
    reviewRepository.seed(
      Review.create({
        id: reviewId,
        userId,
        restaurantId,
        reservationId: '44444444-4444-4444-8444-444444444444',
        rating: 5,
        comment: 'Great!',
        now: FIXED_NOW,
      }),
    );

    const result = await useCase.execute({ reviewId });
    expect(result.rating).toBe(5);
    expect(result.reviewerUsername).toBe('jane_doe');
  });

  it('rejects an unknown review', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({ reviewId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toBeInstanceOf(ReviewNotFoundException);
  });

  it('never returns a soft-deleted review', async () => {
    const { useCase, reviewRepository } = await build();
    const review = Review.create({
      id: reviewId,
      userId,
      restaurantId,
      reservationId: '44444444-4444-4444-8444-444444444444',
      rating: 5,
      comment: null,
      now: FIXED_NOW,
    });
    reviewRepository.seed(review.softDelete(FIXED_NOW));

    await expect(useCase.execute({ reviewId })).rejects.toBeInstanceOf(ReviewNotFoundException);
  });
});
