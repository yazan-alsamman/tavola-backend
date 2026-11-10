import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import {
  RestaurantGalleryRepository,
  RESTAURANT_GALLERY_REPOSITORY,
} from '../../domain/repositories/restaurant-gallery.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { InvalidRestaurantGalleryImageException } from '../../domain/exceptions/invalid-restaurant-gallery-image.exception';
import { ReorderRestaurantGalleryCommand } from '../dto/reorder-restaurant-gallery.command';

/**
 * ADR-046: drag ordering of the gallery. The request lists every image of
 * the restaurant exactly once; each image's position becomes its index. A
 * partial or stale list (an image added or removed meanwhile) is rejected,
 * so two editors never silently interleave.
 */
@Injectable()
export class ReorderRestaurantGalleryUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESTAURANT_GALLERY_REPOSITORY)
    private readonly galleryRepository: RestaurantGalleryRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: ReorderRestaurantGalleryCommand): Promise<void> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const images = await this.galleryRepository.findAllByRestaurantId(restaurantId);
    const byId = new Map(images.map((image) => [image.galleryImageId, image]));
    const requested = new Set(command.galleryItemIds);
    if (
      requested.size !== command.galleryItemIds.length ||
      requested.size !== byId.size ||
      command.galleryItemIds.some((id) => !byId.has(id))
    ) {
      throw new InvalidRestaurantGalleryImageException(
        'galleryItemIds must list every gallery image of the restaurant exactly once.',
      );
    }

    const now = this.clock.now();
    const moved = command.galleryItemIds
      .map((id, index) => ({ image: byId.get(id)!, index }))
      .filter(({ image, index }) => image.sortOrder !== index)
      .map(({ image, index }) => image.moveTo(index, now));

    if (moved.length === 0) {
      return;
    }
    await this.unitOfWork.execute(async () => {
      await this.galleryRepository.updateSortOrders(moved);
    });

    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'restaurant.gallery.reordered',
      targetType: 'Restaurant',
      targetId: restaurantId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });
  }
}
