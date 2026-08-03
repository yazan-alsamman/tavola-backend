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
import {
  MenuItemOptionRepository,
  MENU_ITEM_OPTION_REPOSITORY,
} from '../../domain/repositories/menu-item-option.repository';
import { MenuItemOption } from '../../domain/entities/menu-item-option.entity';
import { OptionCreatedEvent } from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { toMenuItemOptionResult } from '../mappers/menu-item-option-result.mapper';
import { CreateMenuItemOptionCommand } from '../dto/menu-item-option.commands';
import { MenuItemOptionResult } from '../dto/menu-item-option.result';

@Injectable()
export class CreateMenuItemOptionUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_ITEM_OPTION_GROUP_REPOSITORY)
    private readonly optionGroupRepository: MenuItemOptionGroupRepository,
    @Inject(MENU_ITEM_OPTION_REPOSITORY)
    private readonly optionRepository: MenuItemOptionRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: CreateMenuItemOptionCommand): Promise<MenuItemOptionResult> {
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

    const existing = await this.optionRepository.findManyByOptionGroupId(optionGroupId);
    const nextDisplayOrder = existing.reduce((max, o) => Math.max(max, o.displayOrder), -1) + 1;

    const now = this.clock.now();
    const option = MenuItemOption.create({
      id: this.idGenerator.generate(),
      optionGroupId: optionGroupId.value,
      restaurantId: restaurantId.value,
      content: command.content,
      displayOrder: nextDisplayOrder,
      now,
    });

    await this.unitOfWork.execute(async () => {
      await this.optionRepository.create(option);
    });

    const actorId = resolveMenuManagementActorId(command.actor);
    await this.eventPublisher.publish(
      new OptionCreatedEvent(
        this.idGenerator.generate(),
        {
          optionId: option.menuItemOptionId.value,
          optionGroupId: optionGroupId.value,
          restaurantId: restaurantId.value,
          actorId,
        },
        now,
        command.correlationId,
      ),
    );

    return toMenuItemOptionResult(option);
  }
}
