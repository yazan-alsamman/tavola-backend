import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { RestaurantId, FileId } from '@shared/domain/value-objects/identifiers.vo';
import {
  FileRepository,
  FILE_REPOSITORY,
} from '@modules/files/domain/repositories/file.repository';
import { FileRecord } from '@modules/files/domain/entities/file-record.entity';
import { StoragePort, STORAGE_PORT } from '@modules/files/application/ports/storage.port';
import { detectImageMimeType } from '@modules/files/domain/services/image-signature.detector';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import {
  BranchCoverImageRepository,
  BRANCH_COVER_IMAGE_REPOSITORY,
} from '../../domain/repositories/branch-cover-image.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { MissingRestaurantImageFileException } from '../../domain/exceptions/missing-restaurant-image-file.exception';
import { RestaurantImageFileTooLargeException } from '../../domain/exceptions/restaurant-image-file-too-large.exception';
import { UnsupportedRestaurantImageFileTypeException } from '../../domain/exceptions/unsupported-restaurant-image-file-type.exception';
import { InvalidRestaurantImageFileException } from '../../domain/exceptions/invalid-restaurant-image-file.exception';
import { RestaurantImageStorageUnavailableException } from '../../domain/exceptions/restaurant-image-storage-unavailable.exception';
import {
  GALLERY_IMAGE_MAX_SIZE_BYTES,
  isAllowedGalleryImageMimeType,
} from '../policies/gallery-upload.policy';
import { GALLERY_BUCKET } from '../tokens/restaurants.tokens';
import { UploadedGalleryImageFile } from '../dto/add-restaurant-gallery-image.command';
import {
  RestaurantImageSlot,
  UploadRestaurantImageCommand,
  UploadRestaurantImageResult,
} from '../dto/upload-restaurant-image.command';

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const ACCESS_POLICY = 'Public' as const;

/**
 * Stores a restaurant cover or logo in the existing public bucket and writes
 * the resulting File id onto `Restaurant.coverImageId` or `Restaurant.logoId`.
 * Gallery uploads stay on `RestaurantGalleryImage` and never become the cover.
 *
 * Replace semantics match avatar upload: the new object is persisted first,
 * then the restaurant column is updated, then the previous file is removed.
 * A failed upload never leaves the column pointing at a missing object.
 *
 * ADR-051: a cover upload that names a `branchId` writes `Branch.coverImageId`
 * instead. Branches may share a cover file with the restaurant or each other
 * (the data migration copied it), so the previous file is only deleted once no
 * restaurant or branch references it any more.
 */
@Injectable()
export class UploadRestaurantImageUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(FILE_REPOSITORY) private readonly fileRepository: FileRepository,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
    @Inject(GALLERY_BUCKET) private readonly bucket: string,
    @Inject(BRANCH_COVER_IMAGE_REPOSITORY)
    private readonly branchCoverImageRepository: BranchCoverImageRepository,
  ) {}

  async execute(command: UploadRestaurantImageCommand): Promise<UploadRestaurantImageResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const { file, mimeType: detectedMimeType } = this.validate(command.file);

    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const branchId = command.slot === 'cover' ? (command.branchId ?? null) : null;
    let previousFileId: string | null;
    if (branchId !== null) {
      const branchCover = await this.branchCoverImageRepository.findCoverImageId(
        restaurantId,
        branchId,
      );
      if (branchCover === undefined) {
        throw new BranchNotFoundException();
      }
      previousFileId = branchCover;
    } else {
      previousFileId = command.slot === 'cover' ? restaurant.coverImageId : restaurant.logoId;
    }

    const now = this.clock.now();
    const fileId = this.idGenerator.generate();
    const extension = EXTENSION_BY_MIME_TYPE[detectedMimeType];
    const objectKey =
      branchId !== null
        ? `restaurants/${restaurantId.value}/branches/${branchId}/cover/${fileId}.${extension}`
        : `restaurants/${restaurantId.value}/${command.slot}/${fileId}.${extension}`;

    await this.uploadOrFail(objectKey, file, detectedMimeType);

    const fileRecord = FileRecord.create({
      id: fileId,
      ownerId: restaurantId.value,
      ownerType: 'Restaurant',
      bucket: this.bucket,
      objectKey,
      mimeType: detectedMimeType,
      sizeBytes: file.sizeBytes,
      accessPolicy: ACCESS_POLICY,
      createdAt: now,
      deletedAt: null,
    });

    try {
      await this.fileRepository.create(fileRecord);
    } catch (error) {
      await this.compensateUpload(objectKey);
      throw error;
    }

    try {
      if (branchId !== null) {
        await this.branchCoverImageRepository.assignCoverImage(branchId, fileId, now);
      } else {
        await this.restaurantRepository.save(
          restaurant.assignBrandImage(command.slot, fileId, now),
        );
      }
    } catch (error) {
      await this.fileRepository.softDelete(FileId.create(fileId), now).catch(() => undefined);
      await this.compensateUpload(objectKey);
      throw error;
    }

    if (previousFileId !== null && previousFileId !== fileId) {
      await this.cleanupPrevious(previousFileId, now);
    }

    await this.auditLogWriter.record({
      actorId: command.actorUserId,
      actorType: 'User',
      action: branchId !== null ? 'branch.cover.uploaded' : this.auditAction(command.slot),
      targetType: branchId !== null ? 'Branch' : 'Restaurant',
      targetId: branchId ?? restaurantId.value,
      organizationId: command.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    const imageUrl = await this.storagePort.getSignedReadUrl(this.bucket, objectKey);
    return {
      slot: command.slot,
      branchId,
      fileId,
      imageUrl,
      mimeType: detectedMimeType,
      sizeBytes: file.sizeBytes,
    };
  }

  private auditAction(slot: RestaurantImageSlot): string {
    return slot === 'cover' ? 'restaurant.cover.uploaded' : 'restaurant.logo.uploaded';
  }

  private validate(file: UploadedGalleryImageFile | null): {
    file: UploadedGalleryImageFile;
    mimeType: string;
  } {
    if (file === null || file.sizeBytes <= 0 || file.buffer.length === 0) {
      throw new MissingRestaurantImageFileException();
    }
    if (file.sizeBytes > GALLERY_IMAGE_MAX_SIZE_BYTES) {
      throw new RestaurantImageFileTooLargeException(GALLERY_IMAGE_MAX_SIZE_BYTES);
    }
    if (!isAllowedGalleryImageMimeType(file.mimeType)) {
      throw new UnsupportedRestaurantImageFileTypeException(file.mimeType);
    }
    const detected = detectImageMimeType(file.buffer);
    if (detected === null || detected !== file.mimeType) {
      throw new InvalidRestaurantImageFileException();
    }
    return { file, mimeType: detected };
  }

  private async uploadOrFail(
    objectKey: string,
    file: UploadedGalleryImageFile,
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
      throw new RestaurantImageStorageUnavailableException();
    }
  }

  private async compensateUpload(objectKey: string): Promise<void> {
    try {
      await this.storagePort.delete(this.bucket, objectKey);
    } catch {
      // Best-effort: an orphaned object with no restaurant pointer is never served.
    }
  }

  private async cleanupPrevious(oldFileId: string, at: Date): Promise<void> {
    try {
      const oldFile = await this.fileRepository.findById(FileId.create(oldFileId));
      if (oldFile === null || oldFile.isDeleted()) {
        return;
      }
      if ((await this.branchCoverImageRepository.countCoverReferences(oldFileId)) > 0) {
        return;
      }
      await this.storagePort.delete(oldFile.bucket, oldFile.objectKey);
      await this.fileRepository.softDelete(FileId.create(oldFileId), at);
    } catch {
      // The new image is already the live pointer. A failed cleanup of the
      // previous object must not roll that back.
    }
  }
}
