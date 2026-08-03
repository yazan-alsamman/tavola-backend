import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { FloorPlanId, TableId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { TableRepository, TABLE_REPOSITORY } from '../../domain/repositories/table.repository';
import {
  FloorPlanRepository,
  FLOOR_PLAN_REPOSITORY,
} from '../../domain/repositories/floor-plan.repository';
import { TableNotFoundException } from '../../domain/exceptions/table-not-found.exception';
import { FloorPlanNotFoundException } from '../../domain/exceptions/floor-plan-not-found.exception';
import { TableMergedOperationForbiddenException } from '../../domain/exceptions/table-merged-operation-forbidden.exception';
import { TableMovedEvent } from '../../domain/events/table.events';
import { toTableResult } from '../mappers/table-result.mapper';
import { MoveTableCommand } from '../dto/move-table.command';
import { TableResult } from '../dto/table.result';

/**
 * Move Table (Phase 6.2 architecture decision, TASKS.md) - a dedicated
 * Domain Action reachable via the flat `POST /tables/:tableId/move` route.
 * Tenant validation walks Table -> Branch -> Restaurant, exactly like
 * `GetTableUseCase`/`UpdateTableUseCase`/`DeleteTableUseCase`. Changes ONLY
 * `floorPlanId` - never `status`, capacity, position, or any other field.
 * Publishes `TableMovedEvent` through `EVENT_PUBLISHER` (Phase 8 §6 —
 * supersedes the prior "Phase 6.2 decision #7" audit-log-only precedent);
 * `table.moved` auditing now flows through `AuditingEventPublisher` like
 * every other domain event.
 */
@Injectable()
export class MoveTableUseCase {
  constructor(
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(FLOOR_PLAN_REPOSITORY) private readonly floorPlanRepository: FloorPlanRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: MoveTableCommand): Promise<TableResult> {
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
    // currently part of an active merge group can never be moved - Split
    // first. Checked here, BEFORE the target FloorPlan lookup, so the
    // rejection is unconditional regardless of the requested target.
    if (existing.mergeGroupId !== null) {
      throw new TableMergedOperationForbiddenException('move');
    }

    // Scope guard (Phase 6.2 decision #4): the target FloorPlan must exist,
    // belong to this Table's own branch, and not be soft-deleted - a single
    // compound lookup rejects unknown/cross-branch/soft-deleted targets
    // identically, the same IDOR-safe pattern used throughout this module.
    // Cross-branch and cross-restaurant moves are therefore structurally
    // impossible, not merely disallowed by convention.
    const targetFloorPlanId = FloorPlanId.create(command.targetFloorPlanId);
    const targetFloorPlan = await this.floorPlanRepository.findByIdAndBranchId(
      targetFloorPlanId,
      existing.branchId,
    );
    if (targetFloorPlan === null) {
      throw new FloorPlanNotFoundException();
    }

    const now = this.clock.now();
    const oldFloorPlanId = existing.floorPlanId.value;
    const moved = existing.moveToFloorPlan(targetFloorPlanId.value, now);
    await this.tableRepository.save(moved);

    await this.eventPublisher.publish(
      new TableMovedEvent(
        this.idGenerator.generate(),
        {
          tableId: moved.tableId.value,
          branchId: existing.branchId.value,
          organizationId: restaurant.organizationId.value,
          oldFloorPlanId,
          newFloorPlanId: moved.floorPlanId.value,
          actorId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    return toTableResult(moved);
  }
}
