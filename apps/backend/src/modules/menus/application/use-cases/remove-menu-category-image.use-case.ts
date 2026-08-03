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
import { StoragePort, STORAGE_PORT } from '@modules/files/application/ports/storage.port';
import {
  MenuCategoryRepository,
  MENU_CATEGORY_REPOSITORY,
} from '../../domain/repositories/menu-category.repository';
import { MenuCategoryNotFoundException } from '../../domain/exceptions/menu-category-not-found.exception';
import { CategoryUpdatedEvent } from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { RemoveMenuCategoryImageCommand } from '../dto/menu-category.commands';

@Injectable()
export class RemoveMenuCategoryImageUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_CATEGORY_REPOSITORY) private readonly categoryRepository: MenuCategoryRepository,
    @Inject(FILE_REPOSITORY) private readonly fileRepository: FileRepository,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: RemoveMenuCategoryImageCommand): Promise<void> {
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

    const now = this.clock.now();
    const previousFileId = category.imageFileId;
    await this.categoryRepository.update(category.removeImage(now));

    if (previousFileId !== null) {
      const fileRecord = await this.fileRepository.findById(previousFileId);
      await this.fileRepository.softDelete(previousFileId, now).catch(() => undefined);
      if (fileRecord !== null) {
        await this.storagePort
          .delete(fileRecord.bucket, fileRecord.objectKey)
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
  }
}
