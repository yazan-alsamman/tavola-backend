import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { Menu } from '../../domain/entities/menu.entity';
import { MenuRepository, MENU_REPOSITORY } from '../../domain/repositories/menu.repository';
import { MenuCreatedEvent } from '../../domain/events/menu.events';
import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
} from '../services/assert-actor-can-manage-menu';
import { toMenuResult } from '../mappers/menu-result.mapper';
import { CreateMenuCommand } from '../dto/menu.commands';
import { MenuResult } from '../dto/menu.result';

/**
 * Phase 18 (ADR-031/ADR-032). A Restaurant may own multiple Menus - the
 * first Menu created in a scope (shared, or one branch - ADR-046) is auto-marked `isDefault` (no
 * separate `MenuSetAsDefault` event fires for that implicit case, see
 * EVENTS.md).
 */
@Injectable()
export class CreateMenuUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(MENU_REPOSITORY) private readonly menuRepository: MenuRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: CreateMenuCommand): Promise<MenuResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }
    assertActorCanManageMenu(command.actor, restaurantId.value);

    let branchId: BranchId | null = null;
    if (command.branchId) {
      branchId = BranchId.create(command.branchId);
      const branch = await this.branchRepository.findByIdAndRestaurantId(branchId, restaurantId);
      if (branch === null) {
        throw new BranchNotFoundException();
      }
    }

    const alreadyHasMenu = await this.menuRepository.existsAnyForRestaurant(restaurantId, branchId);
    const now = this.clock.now();
    const menu = Menu.create({
      id: this.idGenerator.generate(),
      restaurantId: restaurantId.value,
      branchId: branchId?.value ?? null,
      name: command.name,
      isDefault: !alreadyHasMenu,
      now,
    });

    await this.unitOfWork.execute(async () => {
      await this.menuRepository.create(menu);
    });

    const actorId = resolveMenuManagementActorId(command.actor);
    await this.auditLogWriter.record({
      actorId,
      actorType: command.actor.actorType === 'Employee' ? 'Employee' : 'User',
      action: 'menu.created',
      targetType: 'Menu',
      targetId: menu.menuId.value,
      organizationId: 'organizationId' in command.actor ? command.actor.organizationId : null,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    await this.eventPublisher.publish(
      new MenuCreatedEvent(
        this.idGenerator.generate(),
        { menuId: menu.menuId.value, restaurantId: restaurantId.value, actorId },
        now,
        command.correlationId,
      ),
    );

    return toMenuResult(menu);
  }
}
