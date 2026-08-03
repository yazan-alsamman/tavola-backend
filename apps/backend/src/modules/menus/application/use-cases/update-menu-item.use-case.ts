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
import { InvalidMenuItemException } from '../../domain/exceptions/invalid-menu-item.exception';
import { MenuItemAvailabilityMode } from '../../domain/enums/menu-item.enums';
import {
  MenuItemUpdatedEvent,
  MenuItemAvailabilityChangedEvent,
} from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { toMenuItemResult } from '../mappers/menu-item-result.mapper';
import { UpdateMenuItemCommand } from '../dto/menu-item.commands';
import { MenuItemResult } from '../dto/menu-item.result';

/** EVENTS.md: `MenuItemUpdated` always fires; `MenuItemAvailabilityChanged` additionally fires only when `availabilityMode` actually changes (same request, no separate endpoint). */
@Injectable()
export class UpdateMenuItemUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_ITEM_REPOSITORY) private readonly itemRepository: MenuItemRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: UpdateMenuItemCommand): Promise<MenuItemResult> {
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

    if (
      !Object.values(MenuItemAvailabilityMode).includes(
        command.availabilityMode as MenuItemAvailabilityMode,
      )
    ) {
      throw new InvalidMenuItemException('availabilityMode is not a recognized value.');
    }

    const now = this.clock.now();
    const previousMode = item.availabilityMode;
    const nextMode = command.availabilityMode as MenuItemAvailabilityMode;
    const updated = item.update(command.content, now).changeAvailabilityMode(nextMode, now);

    await this.unitOfWork.execute(async () => {
      await this.itemRepository.update(updated);
    });

    const actorId = resolveMenuManagementActorId(command.actor);
    await this.eventPublisher.publish(
      new MenuItemUpdatedEvent(
        this.idGenerator.generate(),
        { menuItemId: itemId.value, restaurantId: restaurantId.value, actorId },
        now,
        command.correlationId,
      ),
    );

    if (previousMode !== nextMode) {
      await this.eventPublisher.publish(
        new MenuItemAvailabilityChangedEvent(
          this.idGenerator.generate(),
          {
            menuItemId: itemId.value,
            restaurantId: restaurantId.value,
            availabilityMode: nextMode,
            actorId,
          },
          now,
          command.correlationId,
        ),
      );
    }

    return toMenuItemResult(updated);
  }
}
