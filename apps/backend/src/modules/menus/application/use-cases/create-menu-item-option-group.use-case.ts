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
  MenuItemOptionGroupRepository,
  MENU_ITEM_OPTION_GROUP_REPOSITORY,
} from '../../domain/repositories/menu-item-option-group.repository';
import { MenuItemOptionGroup } from '../../domain/entities/menu-item-option-group.entity';
import { OptionGroupCreatedEvent } from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { toMenuItemOptionGroupResult } from '../mappers/menu-item-option-group-result.mapper';
import { CreateMenuItemOptionGroupCommand } from '../dto/menu-item-option-group.commands';
import { MenuItemOptionGroupResult } from '../dto/menu-item-option-group.result';

@Injectable()
export class CreateMenuItemOptionGroupUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_ITEM_REPOSITORY) private readonly itemRepository: MenuItemRepository,
    @Inject(MENU_ITEM_OPTION_GROUP_REPOSITORY)
    private readonly optionGroupRepository: MenuItemOptionGroupRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: CreateMenuItemOptionGroupCommand): Promise<MenuItemOptionGroupResult> {
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

    const existing = await this.optionGroupRepository.findManyByMenuItemId(itemId);
    const nextDisplayOrder = existing.reduce((max, g) => Math.max(max, g.displayOrder), -1) + 1;

    const now = this.clock.now();
    const group = MenuItemOptionGroup.create({
      id: this.idGenerator.generate(),
      menuItemId: itemId.value,
      restaurantId: restaurantId.value,
      content: command.content,
      displayOrder: nextDisplayOrder,
      now,
    });

    await this.unitOfWork.execute(async () => {
      await this.optionGroupRepository.create(group);
    });

    const actorId = resolveMenuManagementActorId(command.actor);
    await this.eventPublisher.publish(
      new OptionGroupCreatedEvent(
        this.idGenerator.generate(),
        {
          optionGroupId: group.optionGroupId.value,
          menuItemId: itemId.value,
          restaurantId: restaurantId.value,
          actorId,
        },
        now,
        command.correlationId,
      ),
    );

    return toMenuItemOptionGroupResult(group);
  }
}
