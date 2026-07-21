import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { RestaurantId, FileId } from '@shared/domain/value-objects/identifiers.vo';
import { CLOCK, ID_GENERATOR } from '@modules/authentication/domain/tokens/authentication.tokens';
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
  RestaurantGalleryRepository,
  RESTAURANT_GALLERY_REPOSITORY,
} from '../../domain/repositories/restaurant-gallery.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { MissingGalleryImageFileException } from '../../domain/exceptions/missing-gallery-image-file.exception';
import { GalleryImageFileTooLargeException } from '../../domain/exceptions/gallery-image-file-too-large.exception';
import { UnsupportedGalleryImageFileTypeException } from '../../domain/exceptions/unsupported-gallery-image-file-type.exception';
import { InvalidGalleryImageFileException } from '../../domain/exceptions/invalid-gallery-image-file.exception';
import { GalleryStorageUnavailableException } from '../../domain/exceptions/gallery-storage-unavailable.exception';
import { RestaurantGalleryLimitExceededException } from '../../domain/exceptions/restaurant-gallery-limit-exceeded.exception';
import { RestaurantGalleryImage } from '../../domain/entities/restaurant-gallery-image.entity';
import {
  GALLERY_IMAGE_MAX_SIZE_BYTES,
  GALLERY_MAX_IMAGES_PER_RESTAURANT,
  isAllowedGalleryImageMimeType,
} from '../policies/gallery-upload.policy';
import { toRestaurantGalleryImageResult } from '../mappers/restaurant-gallery-image-result.mapper';
import {
  AddRestaurantGalleryImageCommand,
  UploadedGalleryImageFile,
} from '../dto/add-restaurant-gallery-image.command';
import { RestaurantGalleryImageResult } from '../dto/restaurant-gallery-image.result';
import { GALLERY_BUCKET } from '../tokens/restaurants.tokens';

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Gallery images are public-facing restaurant photos - same Public-bucket
 * reasoning as avatars (Phase 3.2), approved architecture decision for this
 * phase: reuse the existing public bucket, no new bucket. */
const GALLERY_ACCESS_POLICY = 'Public' as const;

@Injectable()
export class AddRestaurantGalleryImageUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESTAURANT_GALLERY_REPOSITORY)
    private readonly galleryRepository: RestaurantGalleryRepository,
    @Inject(FILE_REPOSITORY) private readonly fileRepository: FileRepository,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
    @Inject(GALLERY_BUCKET) private readonly bucket: string,
  ) {}

  async execute(command: AddRestaurantGalleryImageCommand): Promise<RestaurantGalleryImageResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const { file, mimeType: detectedMimeType } = this.validate(command.file);

    // Tenant isolation gate: RestaurantGallery carries no organizationId of
    // its own (TENANCY.md's "transitively tenant-owned" case, same as
    // RestaurantSettings/WorkingHours) - resolving the parent Restaurant
    // through the already-tenant-scoped RestaurantRepository first is what
    // makes this call safe.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const existing = await this.galleryRepository.findAllByRestaurantId(restaurantId);
    if (existing.length >= GALLERY_MAX_IMAGES_PER_RESTAURANT) {
      throw new RestaurantGalleryLimitExceededException(GALLERY_MAX_IMAGES_PER_RESTAURANT);
    }
    const nextSortOrder = existing.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;

    const now = this.clock.now();
    const fileId = this.idGenerator.generate();
    const objectKey = `restaurants/${restaurantId.value}/gallery/${fileId}.${EXTENSION_BY_MIME_TYPE[detectedMimeType]}`;

    await this.uploadOrFail(objectKey, file, detectedMimeType);

    const fileRecord = FileRecord.create({
      id: fileId,
      ownerId: restaurantId.value,
      ownerType: 'Restaurant',
      bucket: this.bucket,
      objectKey,
      mimeType: detectedMimeType,
      sizeBytes: file.sizeBytes,
      accessPolicy: GALLERY_ACCESS_POLICY,
      createdAt: now,
      deletedAt: null,
    });

    try {
      await this.fileRepository.create(fileRecord);
    } catch (error) {
      await this.compensateUpload(objectKey);
      throw error;
    }

    const galleryImage = RestaurantGalleryImage.create({
      id: this.idGenerator.generate(),
      restaurantId: restaurantId.value,
      fileId,
      caption: command.caption,
      sortOrder: nextSortOrder,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await this.galleryRepository.add(galleryImage);
    } catch (error) {
      await this.fileRepository.softDelete(FileId.create(fileId), now).catch(() => undefined);
      await this.compensateUpload(objectKey);
      throw error;
    }

    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'restaurant.gallery.image_added',
      targetType: 'Restaurant',
      targetId: restaurantId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    const imageUrl = await this.storagePort.getSignedReadUrl(this.bucket, objectKey);
    return toRestaurantGalleryImageResult(galleryImage, imageUrl);
  }

  /** Throws on any violation; returns the file plus its verified real MIME type otherwise. */
  private validate(file: UploadedGalleryImageFile | null): {
    file: UploadedGalleryImageFile;
    mimeType: string;
  } {
    if (file === null || file.sizeBytes <= 0 || file.buffer.length === 0) {
      throw new MissingGalleryImageFileException();
    }
    if (file.sizeBytes > GALLERY_IMAGE_MAX_SIZE_BYTES) {
      throw new GalleryImageFileTooLargeException(GALLERY_IMAGE_MAX_SIZE_BYTES);
    }
    if (!isAllowedGalleryImageMimeType(file.mimeType)) {
      throw new UnsupportedGalleryImageFileTypeException(file.mimeType);
    }
    const detected = detectImageMimeType(file.buffer);
    if (detected === null || detected !== file.mimeType) {
      throw new InvalidGalleryImageFileException();
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
      throw new GalleryStorageUnavailableException();
    }
  }

  private async compensateUpload(objectKey: string): Promise<void> {
    try {
      await this.storagePort.delete(this.bucket, objectKey);
    } catch {
      // Best-effort compensation: an orphaned object with no DB reference is
      // never served (nothing points to it) but should be surfaced for ops
      // cleanup rather than crashing a request that already failed.
    }
  }
}
