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
import { MenuUpdatedEvent } from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { toMenuResult } from '../mappers/menu-result.mapper';
import { UpdateMenuCommand } from '../dto/menu.commands';
import { MenuResult } from '../dto/menu.result';

/** `displayOrder` change only (EVENTS.md `MenuUpdated`) - `active`/`isDefault` use their own dedicated use cases/events. */
@Injectable()
export class UpdateMenuUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_REPOSITORY) private readonly menuRepository: MenuRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: UpdateMenuCommand): Promise<MenuResult> {
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

    const now = this.clock.now();
    const updated = menu.update({ name: command.name, displayOrder: command.displayOrder }, now);

    await this.unitOfWork.execute(async () => {
      await this.menuRepository.update(updated);
    });

    const actorId = resolveMenuManagementActorId(command.actor);
    await this.eventPublisher.publish(
      new MenuUpdatedEvent(
        this.idGenerator.generate(),
        { menuId: menuId.value, restaurantId: restaurantId.value, actorId },
        now,
        command.correlationId,
      ),
    );

    return toMenuResult(updated);
  }
}
