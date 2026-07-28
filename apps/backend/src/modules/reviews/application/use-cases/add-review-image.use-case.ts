import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { ReviewId, FileId } from '@shared/domain/value-objects/identifiers.vo';
import { CLOCK, ID_GENERATOR } from '@modules/authentication/domain/tokens/authentication.tokens';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  FileRepository,
  FILE_REPOSITORY,
} from '@modules/files/domain/repositories/file.repository';
import { FileRecord } from '@modules/files/domain/entities/file-record.entity';
import { StoragePort, STORAGE_PORT } from '@modules/files/application/ports/storage.port';
import { detectImageMimeType } from '@modules/files/domain/services/image-signature.detector';
import { ReviewRepository, REVIEW_REPOSITORY } from '../../domain/repositories/review.repository';
import {
  ReviewImageRepository,
  REVIEW_IMAGE_REPOSITORY,
} from '../../domain/repositories/review-image.repository';
import { ReviewImage } from '../../domain/entities/review-image.entity';
import { ReviewNotFoundException } from '../../domain/exceptions/review-not-found.exception';
import { MissingReviewImageFileException } from '../../domain/exceptions/missing-review-image-file.exception';
import { ReviewImageFileTooLargeException } from '../../domain/exceptions/review-image-file-too-large.exception';
import { UnsupportedReviewImageFileTypeException } from '../../domain/exceptions/unsupported-review-image-file-type.exception';
import { InvalidReviewImageFileException } from '../../domain/exceptions/invalid-review-image-file.exception';
import { ReviewImageStorageUnavailableException } from '../../domain/exceptions/review-image-storage-unavailable.exception';
import { ReviewImageLimitExceededException } from '../../domain/exceptions/review-image-limit-exceeded.exception';
import {
  REVIEW_IMAGE_MAX_SIZE_BYTES,
  REVIEW_MAX_IMAGES_PER_REVIEW,
  isAllowedReviewImageMimeType,
} from '../policies/review-image-upload.policy';
import { REVIEW_IMAGES_BUCKET } from '../tokens/reviews.tokens';
import { AddReviewImageCommand, UploadedReviewImageFile } from '../dto/add-review-image.command';
import { ReviewImageUploadResult } from '../dto/review-image.result';

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Review images are public-facing content once the review is public
 *  (owner decision #13) - same Public-bucket reasoning as Restaurant
 *  Gallery/Avatars. */
const REVIEW_IMAGE_ACCESS_POLICY = 'Public' as const;

/**
 * Phase 10 (Reviews, architecture frozen 2026-07-26, owner decision #15).
 * Reuses the existing Files/MinIO pipeline exactly - upload -> `FileRecord`
 * (`ownerType: 'Review'`) -> `ReviewImage` join row -> compensate on any
 * downstream failure -> audit -> signed URL, mirroring
 * `AddRestaurantGalleryImageUseCase` line-for-line. Owning Customer only -
 * no dual-actor branching, route guarded only by
 * `JwtAuthGuard`/`SessionVersionGuard`.
 */
@Injectable()
export class AddReviewImageUseCase {
  constructor(
    @Inject(REVIEW_REPOSITORY) private readonly reviewRepository: ReviewRepository,
    @Inject(REVIEW_IMAGE_REPOSITORY) private readonly reviewImageRepository: ReviewImageRepository,
    @Inject(FILE_REPOSITORY) private readonly fileRepository: FileRepository,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
    @Inject(REVIEW_IMAGES_BUCKET) private readonly bucket: string,
  ) {}

  async execute(command: AddReviewImageCommand): Promise<ReviewImageUploadResult> {
    const reviewId = ReviewId.create(command.reviewId);
    const review = await this.reviewRepository.findById(reviewId);
    if (
      review === null ||
      command.actor.actorType !== AccessTokenActorType.User ||
      review.userId.value !== command.actor.userId
    ) {
      throw new ReviewNotFoundException();
    }

    const { file, mimeType: detectedMimeType } = this.validate(command.file);

    const existingCount = await this.reviewImageRepository.countByReviewId(reviewId);
    if (existingCount >= REVIEW_MAX_IMAGES_PER_REVIEW) {
      throw new ReviewImageLimitExceededException(REVIEW_MAX_IMAGES_PER_REVIEW);
    }

    const now = this.clock.now();
    const fileId = this.idGenerator.generate();
    const objectKey = `reviews/${reviewId.value}/images/${fileId}.${EXTENSION_BY_MIME_TYPE[detectedMimeType]}`;

    await this.uploadOrFail(objectKey, file, detectedMimeType);

    const fileRecord = FileRecord.create({
      id: fileId,
      ownerId: reviewId.value,
      ownerType: 'Review',
      bucket: this.bucket,
      objectKey,
      mimeType: detectedMimeType,
      sizeBytes: file.sizeBytes,
      accessPolicy: REVIEW_IMAGE_ACCESS_POLICY,
      createdAt: now,
      deletedAt: null,
    });

    try {
      await this.fileRepository.create(fileRecord);
    } catch (error) {
      await this.compensateUpload(objectKey);
      throw error;
    }

    const existingImages = await this.reviewImageRepository.findManyByReviewId(reviewId);
    const nextSortOrder =
      existingImages.reduce((max, image) => Math.max(max, image.sortOrder), -1) + 1;

    const reviewImage = ReviewImage.create({
      id: this.idGenerator.generate(),
      reviewId: reviewId.value,
      fileId,
      sortOrder: nextSortOrder,
      createdAt: now,
      deletedAt: null,
    });

    try {
      await this.reviewImageRepository.create(reviewImage);
    } catch (error) {
      await this.fileRepository.softDelete(FileId.create(fileId), now).catch(() => undefined);
      await this.compensateUpload(objectKey);
      throw error;
    }

    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'review.image_added',
      targetType: 'Review',
      targetId: reviewId.value,
      organizationId: null,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    const imageUrl = await this.storagePort.getSignedReadUrl(this.bucket, objectKey);
    return {
      reviewImageId: reviewImage.reviewImageId.value,
      reviewId: reviewId.value,
      sortOrder: reviewImage.sortOrder,
      imageUrl,
      createdAt: reviewImage.createdAt,
    };
  }

  private validate(file: UploadedReviewImageFile | null): {
    file: UploadedReviewImageFile;
    mimeType: string;
  } {
    if (file === null || file.sizeBytes <= 0 || file.buffer.length === 0) {
      throw new MissingReviewImageFileException();
    }
    if (file.sizeBytes > REVIEW_IMAGE_MAX_SIZE_BYTES) {
      throw new ReviewImageFileTooLargeException(REVIEW_IMAGE_MAX_SIZE_BYTES);
    }
    if (!isAllowedReviewImageMimeType(file.mimeType)) {
      throw new UnsupportedReviewImageFileTypeException(file.mimeType);
    }
    const detected = detectImageMimeType(file.buffer);
    if (detected === null || detected !== file.mimeType) {
      throw new InvalidReviewImageFileException();
    }
    return { file, mimeType: detected };
  }

  private async uploadOrFail(
    objectKey: string,
    file: UploadedReviewImageFile,
    contentType: string,
  ): Promise<void> {
    try {
      await this.storagePort.upload({
        bucket: this.bucket,
        objectKey,
        body: file.buffer,
        contentType,
        sizeBytes: file.sizeBytes,
      });
    } catch {
      throw new ReviewImageStorageUnavailableException();
    }
  }

  private async compensateUpload(objectKey: string): Promise<void> {
    try {
      await this.storagePort.delete(this.bucket, objectKey);
    } catch {
      // Best-effort compensation, mirrors AddRestaurantGalleryImageUseCase's
      // own precedent - an orphaned object with no DB reference is never
      // served, but should be surfaced for ops cleanup rather than crashing
      // a request that already failed.
    }
  }
}
