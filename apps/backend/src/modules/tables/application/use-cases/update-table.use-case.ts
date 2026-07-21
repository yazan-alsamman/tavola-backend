import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { TableId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CLOCK,
  ID_GENERATOR,
  EVENT_PUBLISHER,
} from '@modules/authentication/domain/tokens/authentication.tokens';
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
import { TableNumberAlreadyExistsException } from '../../domain/exceptions/table-number-already-exists.exception';
import { TableUpdatedEvent } from '../../domain/events/table.events';
import { toTableResult } from '../mappers/table-result.mapper';
import { UpdateTableCommand } from '../dto/update-table.command';
import { TableResult } from '../dto/table.result';

/**
 * Flat route (`PATCH /tables/:tableId`) - tenant validation walks Table ->
 * Branch -> Restaurant, see `GetTableUseCase`'s own comment. Never accepts
 * `branchId`/`floorPlanId` (Move Table out of scope) or `status` (Phase 6.1
 * architecture decision: fixed to `Available`).
 */
@Injectable()
export class UpdateTableUseCase {
  constructor(
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: UpdateTableCommand): Promise<TableResult> {
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

    if (command.tableNumber !== existing.tableNumber) {
      const conflict = await this.tableRepository.existsByBranchIdAndTableNumber(
        existing.branchId,
        command.tableNumber,
        tableId,
      );
      if (conflict) {
        throw new TableNumberAlreadyExistsException(command.tableNumber);
      }
    }

    const now = this.clock.now();
    const table = existing.updateProfile(
      {
        tableNumber: command.tableNumber,
        capacity: command.capacity,
        floor: command.floor,
        positionX: command.positionX,
        positionY: command.positionY,
        width: command.width,
        height: command.height,
        rotation: command.rotation,
        shape: command.shape,
        layer: command.layer,
        indoor: command.indoor,
        vip: command.vip,
        smoking: command.smoking,
      },
      now,
    );

    await this.tableRepository.save(table);

    await this.eventPublisher.publish(
      new TableUpdatedEvent(
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

    return toTableResult(table);
  }
}
