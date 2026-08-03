import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { RestaurantId, MenuItemOptionGroupId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  MenuItemOptionGroupRepository,
  MENU_ITEM_OPTION_GROUP_REPOSITORY,
} from '../../domain/repositories/menu-item-option-group.repository';
import { MenuItemOptionGroupNotFoundException } from '../../domain/exceptions/menu-item-option-group-not-found.exception';
import { OptionGroupDeletedEvent } from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { DeleteMenuItemOptionGroupCommand } from '../dto/menu-item-option-group.commands';

@Injectable()
export class DeleteMenuItemOptionGroupUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_ITEM_OPTION_GROUP_REPOSITORY)
    private readonly optionGroupRepository: MenuItemOptionGroupRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: DeleteMenuItemOptionGroupCommand): Promise<void> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }
    assertActorCanManageMenu(command.actor, restaurantId.value);

    const optionGroupId = MenuItemOptionGroupId.create(command.optionGroupId);
    const group = await this.optionGroupRepository.findByIdAndRestaurantId(
      optionGroupId,
      restaurantId,
    );
    if (group === null || group.menuItemId.value !== command.itemId) {
      throw new MenuItemOptionGroupNotFoundException();
    }

    const now = this.clock.now();
    await this.unitOfWork.execute(async () => {
      await this.optionGroupRepository.softDelete(optionGroupId, now);
    });

    const actorId = resolveMenuManagementActorId(command.actor);
    await this.eventPublisher.publish(
      new OptionGroupDeletedEvent(
        this.idGenerator.generate(),
        { optionGroupId: optionGroupId.value, restaurantId: restaurantId.value, actorId },
        now,
        command.correlationId,
      ),
    );
  }
}
