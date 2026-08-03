import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { ReviewId, ReviewImageId } from '@shared/domain/value-objects/identifiers.vo';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  FileRepository,
  FILE_REPOSITORY,
} from '@modules/files/domain/repositories/file.repository';
import { StoragePort, STORAGE_PORT } from '@modules/files/application/ports/storage.port';
import { ReviewRepository, REVIEW_REPOSITORY } from '../../domain/repositories/review.repository';
import {
  ReviewImageRepository,
  REVIEW_IMAGE_REPOSITORY,
} from '../../domain/repositories/review-image.repository';
import { ReviewNotFoundException } from '../../domain/exceptions/review-not-found.exception';
import { ReviewImageNotFoundException } from '../../domain/exceptions/review-image-not-found.exception';
import { DeleteReviewImageCommand } from '../dto/delete-review-image.command';

/**
 * Phase 10 (Reviews, architecture frozen 2026-07-26, owner decision #16).
 * Owning Customer only. Mirrors `RemoveRestaurantGalleryImageUseCase`
 * exactly: soft-deletes the underlying `FileRecord` and best-effort deletes
 * the MinIO object, then soft-deletes the `ReviewImage` row itself (unlike
 * Gallery, which hard-deletes its join row - Phase 10's frozen schema gives
 * `ReviewImage` its own `deletedAt`, so soft delete is used consistently
 * with every other Review-family row). Does not make the Review's own
 * `rating`/`comment` editable, and does not itself delete the Review.
 */
@Injectable()
export class DeleteReviewImageUseCase {
  constructor(
    @Inject(REVIEW_REPOSITORY) private readonly reviewRepository: ReviewRepository,
    @Inject(REVIEW_IMAGE_REPOSITORY) private readonly reviewImageRepository: ReviewImageRepository,
    @Inject(FILE_REPOSITORY) private readonly fileRepository: FileRepository,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: DeleteReviewImageCommand): Promise<void> {
    const reviewId = ReviewId.create(command.reviewId);
    const review = await this.reviewRepository.findById(reviewId);
    if (
      review === null ||
      command.actor.actorType !== AccessTokenActorType.User ||
      review.userId.value !== command.actor.userId
    ) {
      throw new ReviewNotFoundException();
    }

    const reviewImageId = ReviewImageId.create(command.reviewImageId);
    const images = await this.reviewImageRepository.findManyByReviewId(reviewId);
    const image = images.find((candidate) => candidate.reviewImageId.value === reviewImageId.value);
    if (image === undefined) {
      throw new ReviewImageNotFoundException();
    }

    const file = await this.fileRepository.findById(image.fileId);
    if (file !== null) {
      await this.storagePort.delete(file.bucket, file.objectKey).catch(() => undefined);
    }

    const now = this.clock.now();
    await this.unitOfWork.execute(async () => {
      await this.fileRepository.softDelete(image.fileId, now);
      await this.reviewImageRepository.softDelete(reviewImageId, now);
    });

    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'review.image_removed',
      targetType: 'Review',
      targetId: reviewId.value,
      organizationId: null,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });
  }
}
