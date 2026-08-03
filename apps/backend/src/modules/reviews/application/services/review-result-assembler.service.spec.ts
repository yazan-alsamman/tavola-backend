import { ReviewResultAssembler } from './review-result-assembler.service';
import { Review } from '../../domain/entities/review.entity';
import { ReviewImage } from '../../domain/entities/review-image.entity';
import { RestaurantReply } from '../../domain/entities/restaurant-reply.entity';
import { FileRecord } from '@modules/files/domain/entities/file-record.entity';
import { InMemoryReviewImageRepository } from '../../../../../test/reviews/support/in-memory-review-image.repository';
import { InMemoryRestaurantReplyRepository } from '../../../../../test/reviews/support/in-memory-restaurant-reply.repository';
import { InMemoryFileRepository } from '../../../../../test/restaurants/support/in-memory-file-repository';
import { FakeStoragePort } from '../../../../../test/restaurants/support/fake-storage-port';
import { InMemoryUserRepository } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { User } from '@modules/authentication/domain/entities/user.entity';
import { UserStatus } from '@modules/authentication/domain/enums/authentication.enums';

const FIXED_NOW = new Date('2026-07-30T00:00:00.000Z');
const RESTAURANT_ID = '33333333-3333-4333-8333-333333333333';

/**
 * `review-test-fixtures.ts`'s shared `testUser` hardcodes one phone number,
 * fine for single-user specs but collides with `InMemoryUserRepository`'s
 * own phone-uniqueness check when a spec seeds many distinct users (as the
 * bounded-query-count tests below do) - a distinct-phone variant avoids
 * touching that shared fixture used across the Reviews test suite.
 */
function testUser(overrides: { id: string; username?: string | null }): User {
  return User.reconstitute({
    id: overrides.id,
    firstName: null,
    lastName: null,
    email: null,
    phone: `+1555${overrides.id
      .replace(/[^0-9]/g, '')
      .slice(-7)
      .padStart(7, '0')}`,
    username: overrides.username ?? 'test_user',
    passwordHash: 'hash',
    language: 'en',
    preferredCurrency: null,
    notificationOptIn: true,
    marketingOptIn: false,
    status: UserStatus.Active,
    emailVerified: false,
    failedLoginCount: 0,
    lockedUntil: null,
    permissionsVersion: 1,
    sessionVersion: 1,
    passwordChangedAt: null,
    lastLoginAt: null,
    anonymizedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    deletedAt: null,
  });
}

function testReview(overrides: { id: string; userId: string; reservationId: string }): Review {
  return Review.create({
    id: overrides.id,
    userId: overrides.userId,
    restaurantId: RESTAURANT_ID,
    reservationId: overrides.reservationId,
    rating: 5,
    comment: null,
    now: FIXED_NOW,
  });
}

function testImage(overrides: {
  id: string;
  reviewId: string;
  fileId: string;
  sortOrder: number;
}): ReviewImage {
  return ReviewImage.create({
    id: overrides.id,
    reviewId: overrides.reviewId,
    fileId: overrides.fileId,
    sortOrder: overrides.sortOrder,
    createdAt: FIXED_NOW,
    deletedAt: null,
  });
}

function testFile(overrides: { id: string; ownerId: string }): FileRecord {
  return FileRecord.create({
    id: overrides.id,
    ownerId: overrides.ownerId,
    ownerType: 'Review',
    bucket: 'tavla-private',
    objectKey: `reviews/${overrides.id}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    accessPolicy: 'Private',
    createdAt: FIXED_NOW,
    deletedAt: null,
  });
}

function testReply(overrides: { id: string; reviewId: string }): RestaurantReply {
  return RestaurantReply.create({
    id: overrides.id,
    reviewId: overrides.reviewId,
    repliedByUserId: '99999999-9999-4999-8999-999999999999',
    comment: 'Thank you for the feedback!',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  });
}

describe('ReviewResultAssembler', () => {
  function build() {
    const userRepository = new InMemoryUserRepository();
    const reviewImageRepository = new InMemoryReviewImageRepository();
    const restaurantReplyRepository = new InMemoryRestaurantReplyRepository();
    const fileRepository = new InMemoryFileRepository();
    const storagePort = new FakeStoragePort();

    const assembler = new ReviewResultAssembler(
      userRepository,
      reviewImageRepository,
      restaurantReplyRepository,
      fileRepository,
      storagePort,
    );

    return {
      assembler,
      userRepository,
      reviewImageRepository,
      restaurantReplyRepository,
      fileRepository,
      storagePort,
    };
  }

  describe('bounded query behavior (Phase 15 N+1 elimination)', () => {
    it('calls each batch repository method exactly once for assembleMany, regardless of Review count', async () => {
      const deps = build();
      const reviews: Review[] = [];
      for (let i = 0; i < 20; i += 1) {
        const id = `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`;
        const userId = `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`;
        await deps.userRepository.save(testUser({ id: userId, username: `user_${i}` }));
        reviews.push(testReview({ id, userId, reservationId: id }));
      }

      const findManyByIdsSpy = jest.spyOn(deps.userRepository, 'findManyByIds');
      const findManyByReviewIdsImagesSpy = jest.spyOn(
        deps.reviewImageRepository,
        'findManyByReviewIds',
      );
      const findManyByReviewIdsRepliesSpy = jest.spyOn(
        deps.restaurantReplyRepository,
        'findManyByReviewIds',
      );
      const findManyByIdsFilesSpy = jest.spyOn(deps.fileRepository, 'findManyByIds');
      const findByIdSpy = jest.spyOn(deps.userRepository, 'findById');
      const findManyByReviewIdSpy = jest.spyOn(deps.reviewImageRepository, 'findManyByReviewId');
      const findByReviewIdSpy = jest.spyOn(deps.restaurantReplyRepository, 'findByReviewId');
      const findByIdFileSpy = jest.spyOn(deps.fileRepository, 'findById');

      const results = await deps.assembler.assembleMany(reviews);

      expect(results).toHaveLength(20);
      // Exactly one batch call per relation type - O(1), not O(N) - proves the N+1/fan-out is gone.
      expect(findManyByIdsSpy).toHaveBeenCalledTimes(1);
      expect(findManyByReviewIdsImagesSpy).toHaveBeenCalledTimes(1);
      expect(findManyByReviewIdsRepliesSpy).toHaveBeenCalledTimes(1);
      expect(findManyByIdsFilesSpy).toHaveBeenCalledTimes(1);
      // The old per-item methods must never be called from the batched path.
      expect(findByIdSpy).not.toHaveBeenCalled();
      expect(findManyByReviewIdSpy).not.toHaveBeenCalled();
      expect(findByReviewIdSpy).not.toHaveBeenCalled();
      expect(findByIdFileSpy).not.toHaveBeenCalled();
    });

    it('query count does not scale linearly with Review count (1 vs 20 reviews issue the same number of batch calls)', async () => {
      const depsOne = build();
      const reviewOneId = '11111111-1111-4111-8111-111111111111';
      const userOneId = '22222222-2222-4222-8222-222222222222';
      await depsOne.userRepository.save(testUser({ id: userOneId, username: 'solo' }));
      const findManyByIdsSpyOne = jest.spyOn(depsOne.userRepository, 'findManyByIds');
      await depsOne.assembler.assembleMany([
        testReview({ id: reviewOneId, userId: userOneId, reservationId: reviewOneId }),
      ]);

      const depsTwenty = build();
      const reviews: Review[] = [];
      for (let i = 0; i < 20; i += 1) {
        const id = `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`;
        const userId = `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`;
        await depsTwenty.userRepository.save(testUser({ id: userId, username: `user_${i}` }));
        reviews.push(testReview({ id, userId, reservationId: id }));
      }
      const findManyByIdsSpyTwenty = jest.spyOn(depsTwenty.userRepository, 'findManyByIds');
      await depsTwenty.assembler.assembleMany(reviews);

      expect(findManyByIdsSpyOne).toHaveBeenCalledTimes(1);
      expect(findManyByIdsSpyTwenty).toHaveBeenCalledTimes(1);
    });

    it('duplicate reviewIds/userIds do not cause duplicate database work (single review reused via assemble)', async () => {
      const deps = build();
      const reviewId = '11111111-1111-4111-8111-111111111111';
      const userId = '22222222-2222-4222-8222-222222222222';
      await deps.userRepository.save(testUser({ id: userId, username: 'jane' }));
      const review = testReview({ id: reviewId, userId, reservationId: reviewId });

      const findManyByIdsSpy = jest.spyOn(deps.userRepository, 'findManyByIds');
      await deps.assembler.assemble(review);

      expect(findManyByIdsSpy).toHaveBeenCalledTimes(1);
    });

    it('empty Review array returns immediately with no repository calls', async () => {
      const deps = build();
      const findManyByIdsSpy = jest.spyOn(deps.userRepository, 'findManyByIds');
      const findManyByReviewIdsImagesSpy = jest.spyOn(
        deps.reviewImageRepository,
        'findManyByReviewIds',
      );

      const results = await deps.assembler.assembleMany([]);

      expect(results).toEqual([]);
      expect(findManyByIdsSpy).not.toHaveBeenCalled();
      expect(findManyByReviewIdsImagesSpy).not.toHaveBeenCalled();
    });
  });

  describe('behavioral compatibility', () => {
    it('preserves output ordering matching the input Review array order', async () => {
      const deps = build();
      const reviewA = testReview({
        id: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
        reservationId: '11111111-1111-4111-8111-111111111111',
      });
      const reviewB = testReview({
        id: '11111111-1111-4111-8111-111111111112',
        userId: '22222222-2222-4222-8222-222222222222',
        reservationId: '11111111-1111-4111-8111-111111111112',
      });
      await deps.userRepository.save(testUser({ id: '22222222-2222-4222-8222-222222222222' }));

      const results = await deps.assembler.assembleMany([reviewB, reviewA]);

      expect(results[0].reviewId).toBe(reviewB.reviewId.value);
      expect(results[1].reviewId).toBe(reviewA.reviewId.value);
    });

    it('assembles images in sortOrder ascending per review, and reply/username when present', async () => {
      const deps = build();
      const reviewId = '11111111-1111-4111-8111-111111111111';
      const userId = '22222222-2222-4222-8222-222222222222';
      await deps.userRepository.save(testUser({ id: userId, username: 'jane_doe' }));
      await deps.reviewImageRepository.create(
        testImage({
          id: 'aaaaaaaa-0000-4000-8000-000000000002',
          reviewId,
          fileId: 'ffffffff-0000-4000-8000-000000000002',
          sortOrder: 2,
        }),
      );
      await deps.reviewImageRepository.create(
        testImage({
          id: 'aaaaaaaa-0000-4000-8000-000000000001',
          reviewId,
          fileId: 'ffffffff-0000-4000-8000-000000000001',
          sortOrder: 1,
        }),
      );
      deps.fileRepository.seed(
        testFile({ id: 'ffffffff-0000-4000-8000-000000000001', ownerId: reviewId }),
      );
      deps.fileRepository.seed(
        testFile({ id: 'ffffffff-0000-4000-8000-000000000002', ownerId: reviewId }),
      );
      await deps.restaurantReplyRepository.create(
        testReply({ id: 'cccccccc-0000-4000-8000-000000000001', reviewId }),
      );

      const [result] = await deps.assembler.assembleMany([
        testReview({ id: reviewId, userId, reservationId: reviewId }),
      ]);

      expect(result.reviewerUsername).toBe('jane_doe');
      expect(result.images).toHaveLength(2);
      expect(result.images[0].sortOrder).toBe(1);
      expect(result.images[1].sortOrder).toBe(2);
      expect(result.images[0].imageUrl).toContain('signed.example.com');
      expect(result.reply).not.toBeNull();
      expect(result.reply?.comment).toBe('Thank you for the feedback!');
    });

    it('behaves exactly as before when optional relations (user/images/reply/file) are missing', async () => {
      const deps = build();
      const reviewId = '11111111-1111-4111-8111-111111111111';
      const userId = '22222222-2222-4222-8222-222222222222';
      // No user saved, no images, no reply, no file seeded.

      const [result] = await deps.assembler.assembleMany([
        testReview({ id: reviewId, userId, reservationId: reviewId }),
      ]);

      expect(result.reviewerUsername).toBeNull();
      expect(result.images).toEqual([]);
      expect(result.reply).toBeNull();
    });

    it('renders an empty imageUrl when an image references a file that no longer resolves', async () => {
      const deps = build();
      const reviewId = '11111111-1111-4111-8111-111111111111';
      const userId = '22222222-2222-4222-8222-222222222222';
      await deps.userRepository.save(testUser({ id: userId }));
      await deps.reviewImageRepository.create(
        testImage({
          id: 'aaaaaaaa-0000-4000-8000-000000000001',
          reviewId,
          fileId: 'ffffffff-0000-4000-8000-000000000099',
          sortOrder: 0,
        }),
      );
      // Deliberately not seeding the file.

      const [result] = await deps.assembler.assembleMany([
        testReview({ id: reviewId, userId, reservationId: reviewId }),
      ]);

      expect(result.images).toHaveLength(1);
      expect(result.images[0].imageUrl).toBe('');
    });
  });
});
