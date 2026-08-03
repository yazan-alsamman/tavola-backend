import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { TableId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { TableRepository, TABLE_REPOSITORY } from '../../domain/repositories/table.repository';
import { TableNotFoundException } from '../../domain/exceptions/table-not-found.exception';
import { TableDeletedEvent } from '../../domain/events/table.events';
import { DeleteTableCommand } from '../dto/delete-table.command';

/**
 * Flat route (`DELETE /tables/:tableId`) - tenant validation walks Table ->
 * Branch -> Restaurant, see `GetTableUseCase`'s own comment. Soft delete
 * only (API_GUIDELINES.md), matching `DeleteBranchUseCase`'s own precedent.
 */
@Injectable()
export class DeleteTableUseCase {
  constructor(
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: DeleteTableCommand): Promise<void> {
    const tableId = TableId.create(command.tableId);
    const existing = await this.tableRepository.findById(tableId);
    if (existing === null) {
      throw new TableNotFoundException();
    }

    const branch = await this.branchRepository.findById(existing.branchId);
    if (branch === null) {
      throw new TableNotFoundException();
    }

    const restaurant = await this.restaurantRepository.findById(branch.restaurantId);
    if (restaurant === null) {
      throw new TableNotFoundException();
    }

    const now = this.clock.now();
    const table = existing.softDelete(now);
    await this.tableRepository.save(table);

    await this.eventPublisher.publish(
      new TableDeletedEvent(
        this.idGenerator.generate(),
        {
          tableId: table.tableId.value,
          branchId: table.branchId.value,
          floorPlanId: table.floorPlanId.value,
          organizationId: restaurant.organizationId.value,
          actorId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );
  }
}
