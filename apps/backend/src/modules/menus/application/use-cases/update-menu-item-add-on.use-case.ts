import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { RestaurantId, MenuItemAddOnId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  MenuItemAddOnRepository,
  MENU_ITEM_ADD_ON_REPOSITORY,
} from '../../domain/repositories/menu-item-add-on.repository';
import { MenuItemAddOnNotFoundException } from '../../domain/exceptions/menu-item-add-on-not-found.exception';
import { AddOnUpdatedEvent } from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { toMenuItemAddOnResult } from '../mappers/menu-item-add-on-result.mapper';
import { UpdateMenuItemAddOnCommand } from '../dto/menu-item-add-on.commands';
import { MenuItemAddOnResult } from '../dto/menu-item-add-on.result';

@Injectable()
export class UpdateMenuItemAddOnUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_ITEM_ADD_ON_REPOSITORY) private readonly addOnRepository: MenuItemAddOnRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: UpdateMenuItemAddOnCommand): Promise<MenuItemAddOnResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }
    assertActorCanManageMenu(command.actor, restaurantId.value);

    const addOnId = MenuItemAddOnId.create(command.addOnId);
    const addOn = await this.addOnRepository.findByIdAndRestaurantId(addOnId, restaurantId);
    if (addOn === null || addOn.menuItemId.value !== command.itemId) {
      throw new MenuItemAddOnNotFoundException();
    }

    const now = this.clock.now();
    let updated = addOn.update(command.content, now);
    updated = command.active ? updated.activate(now) : updated.deactivate(now);

    await this.unitOfWork.execute(async () => {
      await this.addOnRepository.update(updated);
    });

    const actorId = resolveMenuManagementActorId(command.actor);
    await this.eventPublisher.publish(
      new AddOnUpdatedEvent(
        this.idGenerator.generate(),
        { addOnId: addOnId.value, restaurantId: restaurantId.value, actorId },
        now,
        command.correlationId,
      ),
    );

    return toMenuItemAddOnResult(updated);
  }
}
