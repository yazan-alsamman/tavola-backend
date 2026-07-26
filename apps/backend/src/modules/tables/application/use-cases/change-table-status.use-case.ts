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
import { TableMergedOperationForbiddenException } from '../../domain/exceptions/table-merged-operation-forbidden.exception';
import { TableStatusChangedEvent } from '../../domain/events/table.events';
import { toTableResult } from '../mappers/table-result.mapper';
import { ChangeTableStatusCommand } from '../dto/change-table-status.command';
import { TableResult } from '../dto/table.result';

/**
 * Status Management (TASKS.md "Phase 6 — Status Management" note) - a
 * dedicated Domain Action reachable via the flat `POST /tables/:tableId/status`
 * route. Tenant validation walks Table -> Branch -> Restaurant, exactly like
 * `GetTableUseCase`/`UpdateTableUseCase`/`DeleteTableUseCase`/`MoveTableUseCase`.
 * Changes ONLY `status` - the state machine restriction itself
 * (`Available <-> Occupied`/`Cleaning`/`Disabled` only) is enforced by
 * `Table.transitionStatus`, not duplicated here. Publishes `TableStatusChangedEvent`
 * through `EVENT_PUBLISHER` (Phase 8 §5 — supersedes the prior "Status
 * Management decision #7" audit-log-only precedent); `table.status_changed`
 * auditing now flows through `AuditingEventPublisher` like every other event.
 */
@Injectable()
export class ChangeTableStatusUseCase {
  constructor(
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: ChangeTableStatusCommand): Promise<TableResult> {
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

    // Phase 6 (Merge/Split Tables, ADR-026 decision #11/#13): a table
    // currently part of an active merge group can never change status
    // through this Domain Action (whether primary or secondary) - Split
    // first.
    if (existing.mergeGroupId !== null) {
      throw new TableMergedOperationForbiddenException('status');
    }

    const now = this.clock.now();
    const fromStatus = existing.status;
    const transitioned = existing.transitionStatus(command.status, now);
    await this.tableRepository.save(transitioned);

    await this.eventPublisher.publish(
      new TableStatusChangedEvent(
        this.idGenerator.generate(),
        {
          tableId: transitioned.tableId.value,
          branchId: existing.branchId.value,
          floorPlanId: existing.floorPlanId.value,
          organizationId: restaurant.organizationId.value,
          fromStatus,
          toStatus: transitioned.status,
          actorId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    return toTableResult(transitioned);
  }
}
