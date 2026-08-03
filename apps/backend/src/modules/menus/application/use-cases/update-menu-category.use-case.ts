import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { RestaurantId, MenuCategoryId } from '@shared/domain/value-objects/identifiers.vo';
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
import { CategoryUpdatedEvent } from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { toMenuCategoryResult } from '../mappers/menu-category-result.mapper';
import { UpdateMenuCategoryCommand } from '../dto/menu-category.commands';
import { MenuCategoryResult } from '../dto/menu-category.result';

@Injectable()
export class UpdateMenuCategoryUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_CATEGORY_REPOSITORY) private readonly categoryRepository: MenuCategoryRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: UpdateMenuCategoryCommand): Promise<MenuCategoryResult> {
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
    const updated = category.update({ name: command.name, description: command.description }, now);

    await this.unitOfWork.execute(async () => {
      await this.categoryRepository.update(updated);
    });

    const actorId = resolveMenuManagementActorId(command.actor);
    await this.eventPublisher.publish(
      new CategoryUpdatedEvent(
        this.idGenerator.generate(),
        { categoryId: categoryId.value, restaurantId: restaurantId.value, actorId },
        now,
        command.correlationId,
      ),
    );

    return toMenuCategoryResult(updated);
  }
}
