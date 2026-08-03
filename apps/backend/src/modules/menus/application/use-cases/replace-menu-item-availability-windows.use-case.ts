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
  MenuItemAvailabilityRepository,
  MENU_ITEM_AVAILABILITY_REPOSITORY,
} from '../../domain/repositories/menu-item-availability.repository';
import { MenuItemAvailability } from '../../domain/entities/menu-item-availability.entity';
import { InvalidMenuItemAvailabilityException } from '../../domain/exceptions/invalid-menu-item-availability.exception';
import { MenuItemAvailabilityMode } from '../../domain/enums/menu-item.enums';
import { MenuItemAvailabilityWindowsReplacedEvent } from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { ReplaceMenuItemAvailabilityWindowsCommand } from '../dto/menu-item.commands';

/**
 * ADR-032: whole-set bulk replacement of a Menu Item's relational
 * `MenuItemAvailability` rows, same convention as `CategoriesReordered`/
 * `MenuItemsReordered`. Valid only while `availabilityMode = Scheduled` -
 * every entity in this table validates its own `dayOfWeek`/`startTime`/
 * `endTime` shape (`MenuItemAvailability.create`), this use case only
 * enforces the cross-cutting "Scheduled mode required" rule.
 */
@Injectable()
export class ReplaceMenuItemAvailabilityWindowsUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_ITEM_REPOSITORY) private readonly itemRepository: MenuItemRepository,
    @Inject(MENU_ITEM_AVAILABILITY_REPOSITORY)
    private readonly availabilityRepository: MenuItemAvailabilityRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: ReplaceMenuItemAvailabilityWindowsCommand): Promise<void> {
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
    if (item.availabilityMode !== MenuItemAvailabilityMode.Scheduled) {
      throw new InvalidMenuItemAvailabilityException(
        'Availability windows may only be set while availabilityMode = Scheduled.',
      );
    }

    const now = this.clock.now();
    // Each window is validated via the entity constructor before any
    // persistence - a malformed window throws here, so no partial write.
    const windows = command.windows.map((window) =>
      MenuItemAvailability.create({
        id: this.idGenerator.generate(),
        menuItemId: itemId.value,
        restaurantId: restaurantId.value,
        dayOfWeek: window.dayOfWeek,
        startTime: window.startTime,
        endTime: window.endTime,
        now,
      }),
    );

    await this.unitOfWork.execute(async () => {
      await this.availabilityRepository.replaceForMenuItem(itemId, windows);
    });

    const actorId = resolveMenuManagementActorId(command.actor);
    await this.eventPublisher.publish(
      new MenuItemAvailabilityWindowsReplacedEvent(
        this.idGenerator.generate(),
        {
          menuItemId: itemId.value,
          restaurantId: restaurantId.value,
          windowCount: command.windows.length,
          actorId,
        },
        now,
        command.correlationId,
      ),
    );
  }
}
