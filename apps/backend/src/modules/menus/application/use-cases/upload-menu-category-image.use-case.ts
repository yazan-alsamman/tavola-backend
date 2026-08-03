import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { RestaurantId, MenuCategoryId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  FileRepository,
  FILE_REPOSITORY,
} from '@modules/files/domain/repositories/file.repository';
import { FileRecord } from '@modules/files/domain/entities/file-record.entity';
import { StoragePort, STORAGE_PORT } from '@modules/files/application/ports/storage.port';
import { detectImageMimeType } from '@modules/files/domain/services/image-signature.detector';
import {
  MenuCategoryRepository,
  MENU_CATEGORY_REPOSITORY,
} from '../../domain/repositories/menu-category.repository';
import { MenuCategoryNotFoundException } from '../../domain/exceptions/menu-category-not-found.exception';
import { MissingMenuImageFileException } from '../../domain/exceptions/missing-menu-image-file.exception';
import { MenuImageFileTooLargeException } from '../../domain/exceptions/menu-image-file-too-large.exception';
import { UnsupportedMenuImageFileTypeException } from '../../domain/exceptions/unsupported-menu-image-file-type.exception';
import { InvalidMenuImageFileException } from '../../domain/exceptions/invalid-menu-image-file.exception';
import { MenuImageStorageUnavailableException } from '../../domain/exceptions/menu-image-storage-unavailable.exception';
import {
  MENU_IMAGE_MAX_SIZE_BYTES,
  isAllowedMenuImageMimeType,
} from '../policies/menu-image-upload.policy';
import { CategoryUpdatedEvent } from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { UploadedImageFile, UploadMenuCategoryImageCommand } from '../dto/menu-category.commands';
import { MENU_IMAGE_BUCKET } from '../tokens/menus.tokens';

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MENU_IMAGE_ACCESS_POLICY = 'Public' as const;

/**
 * Reuses the existing Files/MinIO pipeline unchanged (ADR-031 decision #5) -
 * `FileOwnerType.Menu` was already reserved. `MenuCategory.imageFileId` is a
 * bare nullable UUID column (no Prisma relation), matching
 * `Restaurant.logoId` - not a join table like `RestaurantGalleryImage`,
 * since a Category has at most one image, replaced wholesale on re-upload
 * (the prior `FileRecord`, if any, is soft-deleted).
 */
@Injectable()
export class UploadMenuCategoryImageUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_CATEGORY_REPOSITORY) private readonly categoryRepository: MenuCategoryRepository,
    @Inject(FILE_REPOSITORY) private readonly fileRepository: FileRepository,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(MENU_IMAGE_BUCKET) private readonly bucket: string,
  ) {}

  async execute(command: UploadMenuCategoryImageCommand): Promise<{ imageUrl: string }> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }
    assertActorCanManageMenu(command.actor, restaurantId.value);

    const categoryId = MenuCategoryId.create(command.categoryId);
    const category = await this.categoryRepository.findByIdAndRestaurantId(
      categoryId,
      restaurantId,
    );
    if (category === null || category.menuId.value !== command.menuId) {
      throw new MenuCategoryNotFoundException();
    }

    const { file, mimeType } = this.validate(command.file);
    const now = this.clock.now();
    const fileId = this.idGenerator.generate();
    const objectKey = `menus/categories/${categoryId.value}/${fileId}.${EXTENSION_BY_MIME_TYPE[mimeType]}`;

    try {
      await this.storagePort.upload({
        bucket: this.bucket,
        objectKey,
        body: file.buffer,
        contentType: mimeType,
        sizeBytes: file.sizeBytes,
      });
    } catch {
      throw new MenuImageStorageUnavailableException();
    }

    const fileRecord = FileRecord.create({
      id: fileId,
      ownerId: categoryId.value,
      ownerType: 'Menu',
      bucket: this.bucket,
      objectKey,
      mimeType,
      sizeBytes: file.sizeBytes,
      accessPolicy: MENU_IMAGE_ACCESS_POLICY,
      createdAt: now,
      deletedAt: null,
    });

    const previousFileId = category.imageFileId;
    try {
      await this.fileRepository.create(fileRecord);
      await this.categoryRepository.update(category.setImage(fileId, now));
    } catch (error) {
      await this.storagePort.delete(this.bucket, objectKey).catch(() => undefined);
      throw error;
    }

    if (previousFileId !== null) {
      // Fetch before soft-deleting - the row's bucket/objectKey are the only
      // way to know what to remove from MinIO; softDelete itself never
      // returns them (bug found by menu-image-upload.e2e-spec.ts: this step
      // was previously missing entirely, leaving the prior object orphaned
      // in storage after every replace - RemoveMenuCategoryImageUseCase
      // already did this correctly, this now matches it).
      const previousFileRecord = await this.fileRepository.findById(previousFileId);
      await this.fileRepository.softDelete(previousFileId, now).catch(() => undefined);
      if (previousFileRecord !== null) {
        await this.storagePort
          .delete(previousFileRecord.bucket, previousFileRecord.objectKey)
          .catch(() => undefined);
      }
    }

    const actorId = resolveMenuManagementActorId(command.actor);
    await this.eventPublisher.publish(
      new CategoryUpdatedEvent(
        this.idGenerator.generate(),
        { categoryId: categoryId.value, restaurantId: restaurantId.value, actorId },
        now,
        command.correlationId,
      ),
    );

    const imageUrl = await this.storagePort.getSignedReadUrl(this.bucket, objectKey);
    return { imageUrl };
  }

  private validate(file: UploadedImageFile | null): { file: UploadedImageFile; mimeType: string } {
    if (file === null || file.sizeBytes <= 0 || file.buffer.length === 0) {
      throw new MissingMenuImageFileException();
    }
    if (file.sizeBytes > MENU_IMAGE_MAX_SIZE_BYTES) {
      throw new MenuImageFileTooLargeException(MENU_IMAGE_MAX_SIZE_BYTES);
    }
    if (!isAllowedMenuImageMimeType(file.mimeType)) {
      throw new UnsupportedMenuImageFileTypeException(file.mimeType);
    }
    const detected = detectImageMimeType(file.buffer);
    if (detected === null || detected !== file.mimeType) {
      throw new InvalidMenuImageFileException();
    }
    return { file, mimeType: detected };
  }
}
