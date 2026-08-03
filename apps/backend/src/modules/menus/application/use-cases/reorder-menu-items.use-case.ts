import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import {
  RestaurantId,
  MenuCategoryId,
  MenuItemId,
} from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  MenuCategoryRepository,
  MENU_CATEGORY_REPOSITORY,
} from '../../domain/repositories/menu-category.repository';
import { MenuCategoryNotFoundException } from '../../domain/exceptions/menu-category-not-found.exception';
import {
  MenuItemRepository,
  MENU_ITEM_REPOSITORY,
} from '../../domain/repositories/menu-item.repository';
import { MenuReorderSetMismatchException } from '../../domain/exceptions/menu-reorder-set-mismatch.exception';
import { MenuItemsReorderedEvent } from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { toMenuItemResult } from '../mappers/menu-item-result.mapper';
import { ReorderMenuItemsCommand } from '../dto/menu-item.commands';
import { MenuItemResult } from '../dto/menu-item.result';

@Injectable()
export class ReorderMenuItemsUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_CATEGORY_REPOSITORY) private readonly categoryRepository: MenuCategoryRepository,
    @Inject(MENU_ITEM_REPOSITORY) private readonly itemRepository: MenuItemRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: ReorderMenuItemsCommand): Promise<MenuItemResult[]> {
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

    const current = await this.itemRepository.findManyByCategoryId(categoryId);
    const currentIds = new Set(current.map((i) => i.menuItemId.value));
    const requestedIds = command.orderedMenuItemIds;
    const requestedIdSet = new Set(requestedIds);
    const isExactMatch =
      currentIds.size === requestedIdSet.size &&
      requestedIds.every((id) => currentIds.has(id)) &&
      [...currentIds].every((id) => requestedIdSet.has(id));
    if (!isExactMatch) {
      throw new MenuReorderSetMismatchException();
    }

    const now = this.clock.now();
    const orderedItemIds = requestedIds.map((id) => MenuItemId.create(id));

    await this.unitOfWork.execute(async () => {
      await this.itemRepository.reorder(orderedItemIds, now);
    });

    const actorId = resolveMenuManagementActorId(command.actor);
    await this.eventPublisher.publish(
      new MenuItemsReorderedEvent(
        this.idGenerator.generate(),
        {
          categoryId: categoryId.value,
          restaurantId: restaurantId.value,
          orderedMenuItemIds: requestedIds,
          actorId,
        },
        now,
        command.correlationId,
      ),
    );

    const reordered = await this.itemRepository.findManyByCategoryId(categoryId);
    return reordered.map(toMenuItemResult);
  }
}
