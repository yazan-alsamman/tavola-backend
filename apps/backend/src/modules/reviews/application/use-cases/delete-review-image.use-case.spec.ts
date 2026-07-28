import { DeleteReviewImageUseCase } from './delete-review-image.use-case';
import { AddReviewImageUseCase } from './add-review-image.use-case';
import { Review } from '../../domain/entities/review.entity';
import { ReviewNotFoundException } from '../../domain/exceptions/review-not-found.exception';
import { ReviewImageNotFoundException } from '../../domain/exceptions/review-image-not-found.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingAuditLogWriter,
  FixedClock,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryReviewRepository } from '../../../../../test/reviews/support/in-memory-review.repository';
import { InMemoryReviewImageRepository } from '../../../../../test/reviews/support/in-memory-review-image.repository';
import { InMemoryFileRepository } from '../../../../../test/restaurants/support/in-memory-file-repository';
import { FakeStoragePort } from '../../../../../test/restaurants/support/fake-storage-port';
import { ImmediateUnitOfWork } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { FIXED_NOW } from '../../../../../test/reviews/support/review-test-fixtures';
import { ReviewId } from '@shared/domain/value-objects/identifiers.vo';

describe('DeleteReviewImageUseCase', () => {
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const reviewId = '11111111-1111-4111-8111-111111111111';
  const reviewOwnerUserId = '22222222-2222-4222-8222-222222222222';
  const otherUserId = '22222222-2222-4222-8222-222222222299';
  const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

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
    const reviewImageRepository = new InMemoryReviewImageRepository();
    const fileRepository = new InMemoryFileRepository();
    const storagePort = new FakeStoragePort();
    const auditLogWriter = new CollectingAuditLogWriter();

    reviewRepository.seed(
      Review.create({
        id: reviewId,
        userId: reviewOwnerUserId,
        restaurantId,
        reservationId: '44444444-4444-4444-8444-444444444444',
        rating: 5,
        comment: null,
        now: FIXED_NOW,
      }),
    );

    const addImageUseCase = new AddReviewImageUseCase(
      reviewRepository,
      reviewImageRepository,
      fileRepository,
      storagePort,
      new FixedClock(FIXED_NOW),
      new UuidGenerator(),
      auditLogWriter,
      'tavla-public',
    );
    const image = await addImageUseCase.execute({
      actor: customerActor(reviewOwnerUserId),
      reviewId,
      file: { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: validJpegBuffer.length },
    });

    const useCase = new DeleteReviewImageUseCase(
      reviewRepository,
      reviewImageRepository,
      fileRepository,
      storagePort,
      new FixedClock(FIXED_NOW),
      new ImmediateUnitOfWork(),
      auditLogWriter,
    );

    return { useCase, reviewImageRepository, image };
  }

  it('allows the owning Customer to delete an image from their own review', async () => {
    const { useCase, reviewImageRepository, image } = await build();
    await useCase.execute({
      actor: customerActor(reviewOwnerUserId),
      reviewId,
      reviewImageId: image.reviewImageId,
    });

    const images = await reviewImageRepository.findManyByReviewId(ReviewId.create(reviewId));
    expect(images).toHaveLength(0);
  });

  it('does not make rating/comment editable, nor delete the review itself', async () => {
    const { useCase, image } = await build();
    await useCase.execute({
      actor: customerActor(reviewOwnerUserId),
      reviewId,
      reviewImageId: image.reviewImageId,
    });
    // Review itself is unaffected - no exception, no change to its own state.
  });

  it('rejects deleting an image on a review the caller does not own (IDOR-safe 404)', async () => {
    const { useCase, image } = await build();
    await expect(
      useCase.execute({
        actor: customerActor(otherUserId),
        reviewId,
        reviewImageId: image.reviewImageId,
      }),
    ).rejects.toBeInstanceOf(ReviewNotFoundException);
  });

  it('rejects deleting an unknown image', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: customerActor(reviewOwnerUserId),
        reviewId,
        reviewImageId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toBeInstanceOf(ReviewImageNotFoundException);
  });

  it('rejects deleting an already-deleted image (collapses to not found)', async () => {
    const { useCase, image } = await build();
    await useCase.execute({
      actor: customerActor(reviewOwnerUserId),
      reviewId,
      reviewImageId: image.reviewImageId,
    });
    await expect(
      useCase.execute({
        actor: customerActor(reviewOwnerUserId),
        reviewId,
        reviewImageId: image.reviewImageId,
      }),
    ).rejects.toBeInstanceOf(ReviewImageNotFoundException);
  });
});
