import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { RestaurantId, MenuItemOptionId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  MenuItemOptionRepository,
  MENU_ITEM_OPTION_REPOSITORY,
} from '../../domain/repositories/menu-item-option.repository';
import { MenuItemOptionNotFoundException } from '../../domain/exceptions/menu-item-option-not-found.exception';
import { OptionDeletedEvent } from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { DeleteMenuItemOptionCommand } from '../dto/menu-item-option.commands';

@Injectable()
export class DeleteMenuItemOptionUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_ITEM_OPTION_REPOSITORY)
    private readonly optionRepository: MenuItemOptionRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: DeleteMenuItemOptionCommand): Promise<void> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }
    assertActorCanManageMenu(command.actor, restaurantId.value);

    const optionId = MenuItemOptionId.create(command.optionId);
    const option = await this.optionRepository.findByIdAndRestaurantId(optionId, restaurantId);
    if (option === null || option.optionGroupId.value !== command.optionGroupId) {
      throw new MenuItemOptionNotFoundException();
    }

    const now = this.clock.now();
    await this.unitOfWork.execute(async () => {
      await this.optionRepository.softDelete(optionId, now);
    });

    const actorId = resolveMenuManagementActorId(command.actor);
    await this.eventPublisher.publish(
      new OptionDeletedEvent(
        this.idGenerator.generate(),
        { optionId: optionId.value, restaurantId: restaurantId.value, actorId },
        now,
        command.correlationId,
      ),
    );
  }
}
