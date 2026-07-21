import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { CLOCK, UNIT_OF_WORK } from '@modules/authentication/domain/tokens/authentication.tokens';
import {
  FileRepository,
  FILE_REPOSITORY,
} from '@modules/files/domain/repositories/file.repository';
import { StoragePort, STORAGE_PORT } from '@modules/files/application/ports/storage.port';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import {
  RestaurantGalleryRepository,
  RESTAURANT_GALLERY_REPOSITORY,
} from '../../domain/repositories/restaurant-gallery.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { RestaurantGalleryItemNotFoundException } from '../../domain/exceptions/restaurant-gallery-item-not-found.exception';
import { RemoveRestaurantGalleryImageCommand } from '../dto/remove-restaurant-gallery-image.command';

@Injectable()
export class RemoveRestaurantGalleryImageUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESTAURANT_GALLERY_REPOSITORY)
    private readonly galleryRepository: RestaurantGalleryRepository,
    @Inject(FILE_REPOSITORY) private readonly fileRepository: FileRepository,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: RemoveRestaurantGalleryImageCommand): Promise<void> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate - see AddRestaurantGalleryImageUseCase's own comment.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    // IDOR gate: findById is scoped by BOTH the gallery item id AND
    // restaurantId - a gallery item belonging to a different restaurant
    // (even one in the same organization) resolves to null here.
    const image = await this.galleryRepository.findById(command.galleryItemId, restaurantId);
    if (image === null) {
      throw new RestaurantGalleryItemNotFoundException();
    }

    const file = await this.fileRepository.findById(image.fileId);
    if (file !== null) {
      await this.storagePort.delete(file.bucket, file.objectKey).catch(() => undefined);
    }

    const now = this.clock.now();
    // Both writes run inside one transaction so a failure between them can
    // never leave the gallery row pointing at a soft-deleted file.
    await this.unitOfWork.execute(async () => {
      await this.fileRepository.softDelete(image.fileId, now);
      await this.galleryRepository.remove(image.galleryImageId);
    });

    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'restaurant.gallery.image_removed',
      targetType: 'Restaurant',
      targetId: restaurantId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });
  }
}
