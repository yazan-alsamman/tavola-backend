import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { RestaurantId, MenuId } from '@shared/domain/value-objects/identifiers.vo';
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
import { MenuCategory } from '../../domain/entities/menu-category.entity';
import { CategoryCreatedEvent } from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { toMenuCategoryResult } from '../mappers/menu-category-result.mapper';
import { CreateMenuCategoryCommand } from '../dto/menu-category.commands';
import { MenuCategoryResult } from '../dto/menu-category.result';

@Injectable()
export class CreateMenuCategoryUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_REPOSITORY) private readonly menuRepository: MenuRepository,
    @Inject(MENU_CATEGORY_REPOSITORY) private readonly categoryRepository: MenuCategoryRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: CreateMenuCategoryCommand): Promise<MenuCategoryResult> {
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

    const existing = await this.categoryRepository.findManyByMenuId(menuId);
    const nextDisplayOrder = existing.reduce((max, c) => Math.max(max, c.displayOrder), -1) + 1;

    const now = this.clock.now();
    const category = MenuCategory.create({
      id: this.idGenerator.generate(),
      menuId: menuId.value,
      restaurantId: restaurantId.value,
      content: { name: command.name, description: command.description },
      displayOrder: nextDisplayOrder,
      now,
    });

    await this.unitOfWork.execute(async () => {
      await this.categoryRepository.create(category);
    });

    const actorId = resolveMenuManagementActorId(command.actor);
    await this.eventPublisher.publish(
      new CategoryCreatedEvent(
        this.idGenerator.generate(),
        {
          categoryId: category.menuCategoryId.value,
          menuId: menuId.value,
          restaurantId: restaurantId.value,
          actorId,
        },
        now,
        command.correlationId,
      ),
    );

    return toMenuCategoryResult(category);
  }
}
