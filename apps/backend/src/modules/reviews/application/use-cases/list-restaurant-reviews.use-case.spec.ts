import { ListRestaurantReviewsUseCase } from './list-restaurant-reviews.use-case';
import { Review } from '../../domain/entities/review.entity';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryReviewRepository } from '../../../../../test/reviews/support/in-memory-review.repository';
import { InMemoryReviewImageRepository } from '../../../../../test/reviews/support/in-memory-review-image.repository';
import { InMemoryRestaurantReplyRepository } from '../../../../../test/reviews/support/in-memory-restaurant-reply.repository';
import { InMemoryFileRepository } from '../../../../../test/restaurants/support/in-memory-file-repository';
import { FakeStoragePort } from '../../../../../test/restaurants/support/fake-storage-port';
import { InMemoryUserRepository } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { ReviewResultAssembler } from '../services/review-result-assembler.service';
import {
  FIXED_NOW,
  testRestaurant,
  testUser,
} from '../../../../../test/reviews/support/review-test-fixtures';

describe('ListRestaurantReviewsUseCase', () => {
  const organizationId = '99999999-9999-4999-8999-999999999999';
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const userId = '22222222-2222-4222-8222-222222222222';

  async function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const reviewRepository = new InMemoryReviewRepository();
    const userRepository = new InMemoryUserRepository();
    const reviewImageRepository = new InMemoryReviewImageRepository();
    const restaurantReplyRepository = new InMemoryRestaurantReplyRepository();
    const fileRepository = new InMemoryFileRepository();
    const storagePort = new FakeStoragePort();

    await restaurantRepository.save(testRestaurant({ id: restaurantId, organizationId }));
    await userRepository.save(testUser({ id: userId, username: 'jane_doe' }));

    const resultAssembler = new ReviewResultAssembler(
      userRepository,
      reviewImageRepository,
      restaurantReplyRepository,
      fileRepository,
      storagePort,
    );

    const useCase = new ListRestaurantReviewsUseCase(
      restaurantRepository,
      reviewRepository,
      resultAssembler,
    );

    return { useCase, reviewRepository };
  }

  it('lists active reviews for a restaurant, newest first', async () => {
    const { useCase, reviewRepository } = await build();
    reviewRepository.seed(
      Review.create({
        id: '11111111-1111-4111-8111-111111111111',
        userId,
        restaurantId,
        reservationId: '44444444-4444-4444-8444-444444444441',
        rating: 5,
        comment: null,
        now: new Date('2026-07-20T00:00:00.000Z'),
      }),
    );
    reviewRepository.seed(
      Review.create({
        id: '11111111-1111-4111-8111-111111111112',
        userId,
        restaurantId,
        reservationId: '44444444-4444-4444-8444-444444444442',
        rating: 3,
        comment: null,
        now: new Date('2026-07-25T00:00:00.000Z'),
      }),
    );

    const result = await useCase.execute({ restaurantId, page: 1, limit: 20 });

    expect(result.total).toBe(2);
    expect(result.items[0].rating).toBe(3);
    expect(result.items[1].rating).toBe(5);
    expect(result.items[0].reviewerUsername).toBe('jane_doe');
  });

  it('never includes a soft-deleted review', async () => {
    const { useCase, reviewRepository } = await build();
    const review = Review.create({
      id: '11111111-1111-4111-8111-111111111111',
      userId,
      restaurantId,
      reservationId: '44444444-4444-4444-8444-444444444441',
      rating: 5,
      comment: null,
      now: FIXED_NOW,
    });
    reviewRepository.seed(review.softDelete(FIXED_NOW));

    const result = await useCase.execute({ restaurantId, page: 1, limit: 20 });
    expect(result.total).toBe(0);
  });

  it('rejects listing reviews for an unknown restaurant', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({ restaurantId: '00000000-0000-4000-8000-000000000000', page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('paginates results', async () => {
    const { useCase, reviewRepository } = await build();
    for (let i = 0; i < 3; i += 1) {
      reviewRepository.seed(
        Review.create({
          id: `11111111-1111-4111-8111-11111111111${i}`,
          userId,
          restaurantId,
          reservationId: `44444444-4444-4444-8444-44444444444${i}`,
          rating: 5,
          comment: null,
          now: FIXED_NOW,
        }),
      );
    }

    const result = await useCase.execute({ restaurantId, page: 1, limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(2);
  });
});
