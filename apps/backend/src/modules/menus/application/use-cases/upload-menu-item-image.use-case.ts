import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { RestaurantId, MenuItemId } from '@shared/domain/value-objects/identifiers.vo';
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
  MenuItemRepository,
  MENU_ITEM_REPOSITORY,
} from '../../domain/repositories/menu-item.repository';
import { MenuItemNotFoundException } from '../../domain/exceptions/menu-item-not-found.exception';
import { MissingMenuImageFileException } from '../../domain/exceptions/missing-menu-image-file.exception';
import { MenuImageFileTooLargeException } from '../../domain/exceptions/menu-image-file-too-large.exception';
import { UnsupportedMenuImageFileTypeException } from '../../domain/exceptions/unsupported-menu-image-file-type.exception';
import { InvalidMenuImageFileException } from '../../domain/exceptions/invalid-menu-image-file.exception';
import { MenuImageStorageUnavailableException } from '../../domain/exceptions/menu-image-storage-unavailable.exception';
import {
  MENU_IMAGE_MAX_SIZE_BYTES,
  isAllowedMenuImageMimeType,
} from '../policies/menu-image-upload.policy';
import { MenuItemUpdatedEvent } from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { UploadedImageFile } from '../dto/menu-category.commands';
import { UploadMenuItemImageCommand } from '../dto/menu-item.commands';
import { MENU_IMAGE_BUCKET } from '../tokens/menus.tokens';

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MENU_IMAGE_ACCESS_POLICY = 'Public' as const;

@Injectable()
export class UploadMenuItemImageUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_ITEM_REPOSITORY) private readonly itemRepository: MenuItemRepository,
    @Inject(FILE_REPOSITORY) private readonly fileRepository: FileRepository,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(MENU_IMAGE_BUCKET) private readonly bucket: string,
  ) {}

  async execute(command: UploadMenuItemImageCommand): Promise<{ imageUrl: string }> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }
    assertActorCanManageMenu(command.actor, restaurantId.value);

    const itemId = MenuItemId.create(command.itemId);
    const item = await this.itemRepository.findByIdAndRestaurantId(itemId, restaurantId);
    if (item === null || item.categoryId.value !== command.categoryId) {
      throw new MenuItemNotFoundException();
    }

    const { file, mimeType } = this.validate(command.file);
    const now = this.clock.now();
    const fileId = this.idGenerator.generate();
    const objectKey = `menus/items/${itemId.value}/${fileId}.${EXTENSION_BY_MIME_TYPE[mimeType]}`;

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
      ownerId: itemId.value,
      ownerType: 'Menu',
      bucket: this.bucket,
      objectKey,
      mimeType,
      sizeBytes: file.sizeBytes,
      accessPolicy: MENU_IMAGE_ACCESS_POLICY,
      createdAt: now,
      deletedAt: null,
    });

    const previousFileId = item.imageFileId;
    try {
      await this.fileRepository.create(fileRecord);
      await this.itemRepository.update(item.setImage(fileId, now));
    } catch (error) {
      await this.storagePort.delete(this.bucket, objectKey).catch(() => undefined);
      throw error;
    }

    if (previousFileId !== null) {
      // Fetch before soft-deleting - see UploadMenuCategoryImageUseCase's own
      // comment: this step was previously missing, orphaning the prior
      // object in storage after every replace.
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
      new MenuItemUpdatedEvent(
        this.idGenerator.generate(),
        { menuItemId: itemId.value, restaurantId: restaurantId.value, actorId },
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
