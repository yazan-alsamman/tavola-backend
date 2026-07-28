import { AddReviewImageUseCase } from './add-review-image.use-case';
import { Review } from '../../domain/entities/review.entity';
import { ReviewNotFoundException } from '../../domain/exceptions/review-not-found.exception';
import { MissingReviewImageFileException } from '../../domain/exceptions/missing-review-image-file.exception';
import { ReviewImageFileTooLargeException } from '../../domain/exceptions/review-image-file-too-large.exception';
import { UnsupportedReviewImageFileTypeException } from '../../domain/exceptions/unsupported-review-image-file-type.exception';
import { InvalidReviewImageFileException } from '../../domain/exceptions/invalid-review-image-file.exception';
import { ReviewImageLimitExceededException } from '../../domain/exceptions/review-image-limit-exceeded.exception';
import { REVIEW_MAX_IMAGES_PER_REVIEW } from '../policies/review-image-upload.policy';
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
import { FIXED_NOW } from '../../../../../test/reviews/support/review-test-fixtures';
import { ReviewId } from '@shared/domain/value-objects/identifiers.vo';

describe('AddReviewImageUseCase', () => {
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

    const useCase = new AddReviewImageUseCase(
      reviewRepository,
      reviewImageRepository,
      fileRepository,
      storagePort,
      new FixedClock(FIXED_NOW),
      new UuidGenerator(),
      auditLogWriter,
      'tavla-public',
    );

    return { useCase, reviewImageRepository, fileRepository, storagePort };
  }

  it('adds an image to the caller own review', async () => {
    const { useCase, reviewImageRepository } = await build();
    const result = await useCase.execute({
      actor: customerActor(reviewOwnerUserId),
      reviewId,
      file: { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: validJpegBuffer.length },
    });

    expect(result.sortOrder).toBe(0);
    expect(result.imageUrl).toContain('tavla-public');
    expect(await reviewImageRepository.countByReviewId(ReviewId.create(reviewId))).toBe(1);
  });

  it('rejects adding an image to a review the caller does not own (IDOR-safe 404)', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: customerActor(otherUserId),
        reviewId,
        file: {
          buffer: validJpegBuffer,
          mimeType: 'image/jpeg',
          sizeBytes: validJpegBuffer.length,
        },
      }),
    ).rejects.toBeInstanceOf(ReviewNotFoundException);
  });

  it('rejects a missing file', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({ actor: customerActor(reviewOwnerUserId), reviewId, file: null }),
    ).rejects.toBeInstanceOf(MissingReviewImageFileException);
  });

  it('rejects a file exceeding the max size', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: customerActor(reviewOwnerUserId),
        reviewId,
        file: { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: 6 * 1024 * 1024 },
      }),
    ).rejects.toBeInstanceOf(ReviewImageFileTooLargeException);
  });

  it('rejects an unsupported mime type', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: customerActor(reviewOwnerUserId),
        reviewId,
        file: { buffer: validJpegBuffer, mimeType: 'image/gif', sizeBytes: validJpegBuffer.length },
      }),
    ).rejects.toBeInstanceOf(UnsupportedReviewImageFileTypeException);
  });

  it('rejects a file whose magic bytes do not match a supported image (spoofed upload)', async () => {
    const { useCase } = await build();
    const htmlBuffer = Buffer.from('<html>not an image</html>', 'utf8');
    await expect(
      useCase.execute({
        actor: customerActor(reviewOwnerUserId),
        reviewId,
        file: { buffer: htmlBuffer, mimeType: 'image/png', sizeBytes: htmlBuffer.length },
      }),
    ).rejects.toBeInstanceOf(InvalidReviewImageFileException);
  });

  it('rejects a 6th image once the review already has 5 active images', async () => {
    const { useCase } = await build();
    for (let i = 0; i < REVIEW_MAX_IMAGES_PER_REVIEW; i += 1) {
      await useCase.execute({
        actor: customerActor(reviewOwnerUserId),
        reviewId,
        file: {
          buffer: validJpegBuffer,
          mimeType: 'image/jpeg',
          sizeBytes: validJpegBuffer.length,
        },
      });
    }

    await expect(
      useCase.execute({
        actor: customerActor(reviewOwnerUserId),
        reviewId,
        file: {
          buffer: validJpegBuffer,
          mimeType: 'image/jpeg',
          sizeBytes: validJpegBuffer.length,
        },
      }),
    ).rejects.toBeInstanceOf(ReviewImageLimitExceededException);
  });

  it('assigns increasing sortOrder values', async () => {
    const { useCase } = await build();
    const first = await useCase.execute({
      actor: customerActor(reviewOwnerUserId),
      reviewId,
      file: { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: validJpegBuffer.length },
    });
    const second = await useCase.execute({
      actor: customerActor(reviewOwnerUserId),
      reviewId,
      file: { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: validJpegBuffer.length },
    });

    expect(first.sortOrder).toBe(0);
    expect(second.sortOrder).toBe(1);
  });

  it('uploads to storage under a Review-scoped object key', async () => {
    const { useCase, storagePort } = await build();
    await useCase.execute({
      actor: customerActor(reviewOwnerUserId),
      reviewId,
      file: { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: validJpegBuffer.length },
    });

    expect(storagePort.uploaded).toHaveLength(1);
    expect(storagePort.uploaded[0].objectKey).toContain(`reviews/${reviewId}/images/`);
  });
});
