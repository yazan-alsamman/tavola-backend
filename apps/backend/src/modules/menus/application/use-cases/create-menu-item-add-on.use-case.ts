import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { RestaurantId, MenuItemId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  MenuItemRepository,
  MENU_ITEM_REPOSITORY,
} from '../../domain/repositories/menu-item.repository';
import { MenuItemNotFoundException } from '../../domain/exceptions/menu-item-not-found.exception';
import {
  MenuItemAddOnRepository,
  MENU_ITEM_ADD_ON_REPOSITORY,
} from '../../domain/repositories/menu-item-add-on.repository';
import { MenuItemAddOn } from '../../domain/entities/menu-item-add-on.entity';
import { AddOnCreatedEvent } from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { toMenuItemAddOnResult } from '../mappers/menu-item-add-on-result.mapper';
import { CreateMenuItemAddOnCommand } from '../dto/menu-item-add-on.commands';
import { MenuItemAddOnResult } from '../dto/menu-item-add-on.result';

@Injectable()
export class CreateMenuItemAddOnUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_ITEM_REPOSITORY) private readonly itemRepository: MenuItemRepository,
    @Inject(MENU_ITEM_ADD_ON_REPOSITORY) private readonly addOnRepository: MenuItemAddOnRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: CreateMenuItemAddOnCommand): Promise<MenuItemAddOnResult> {
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

    const existing = await this.addOnRepository.findManyByMenuItemId(itemId);
    const nextDisplayOrder = existing.reduce((max, a) => Math.max(max, a.displayOrder), -1) + 1;

    const now = this.clock.now();
    const addOn = MenuItemAddOn.create({
      id: this.idGenerator.generate(),
      menuItemId: itemId.value,
      restaurantId: restaurantId.value,
      content: command.content,
      displayOrder: nextDisplayOrder,
      now,
    });

    await this.unitOfWork.execute(async () => {
      await this.addOnRepository.create(addOn);
    });

    const actorId = resolveMenuManagementActorId(command.actor);
    await this.eventPublisher.publish(
      new AddOnCreatedEvent(
        this.idGenerator.generate(),
        {
          addOnId: addOn.menuItemAddOnId.value,
          menuItemId: itemId.value,
          restaurantId: restaurantId.value,
          actorId,
        },
        now,
        command.correlationId,
      ),
    );

    return toMenuItemAddOnResult(addOn);
  }
}
