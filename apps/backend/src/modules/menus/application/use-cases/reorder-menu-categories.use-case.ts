import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { RestaurantId, MenuId, MenuCategoryId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { MenuRepository, MENU_REPOSITORY } from '../../domain/repositories/menu.repository';
import { MenuNotFoundException } from '../../domain/exceptions/menu-not-found.exception';
import {
  MenuCategoryRepository,
  MENU_CATEGORY_REPOSITORY,
} from '../../domain/repositories/menu-category.repository';
import { MenuReorderSetMismatchException } from '../../domain/exceptions/menu-reorder-set-mismatch.exception';
import { CategoriesReorderedEvent } from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { toMenuCategoryResult } from '../mappers/menu-category-result.mapper';
import { ReorderMenuCategoriesCommand } from '../dto/menu-category.commands';
import { MenuCategoryResult } from '../dto/menu-category.result';

/**
 * API_GUIDELINES.md's Bulk Reorder Endpoints convention: `orderedCategoryIds`
 * must exactly match the Menu's current non-deleted Category set (set
 * equality, both directions) - a partial array, a foreign id, or an id
 * belonging to a different Menu is rejected before any `displayOrder` value
 * is written.
 */
@Injectable()
export class ReorderMenuCategoriesUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_REPOSITORY) private readonly menuRepository: MenuRepository,
    @Inject(MENU_CATEGORY_REPOSITORY) private readonly categoryRepository: MenuCategoryRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: ReorderMenuCategoriesCommand): Promise<MenuCategoryResult[]> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }
    assertActorCanManageMenu(command.actor, restaurantId.value);

    const menuId = MenuId.create(command.menuId);
    const menu = await this.menuRepository.findByIdAndRestaurantId(menuId, restaurantId);
    if (menu === null) {
      throw new MenuNotFoundException();
    }

    const current = await this.categoryRepository.findManyByMenuId(menuId);
    const currentIds = new Set(current.map((c) => c.menuCategoryId.value));
    const requestedIds = command.orderedCategoryIds;
    const requestedIdSet = new Set(requestedIds);
    const isExactMatch =
      currentIds.size === requestedIdSet.size &&
      requestedIds.every((id) => currentIds.has(id)) &&
      [...currentIds].every((id) => requestedIdSet.has(id));
    if (!isExactMatch) {
      throw new MenuReorderSetMismatchException();
    }

    const now = this.clock.now();
    const orderedCategoryIds = requestedIds.map((id) => MenuCategoryId.create(id));

    await this.unitOfWork.execute(async () => {
      await this.categoryRepository.reorder(orderedCategoryIds, now);
    });

    const actorId = resolveMenuManagementActorId(command.actor);
    await this.eventPublisher.publish(
      new CategoriesReorderedEvent(
        this.idGenerator.generate(),
        {
          menuId: menuId.value,
          restaurantId: restaurantId.value,
          orderedCategoryIds: requestedIds,
          actorId,
        },
        now,
        command.correlationId,
      ),
    );

    const reordered = await this.categoryRepository.findManyByMenuId(menuId);
    return reordered.map(toMenuCategoryResult);
  }
}
