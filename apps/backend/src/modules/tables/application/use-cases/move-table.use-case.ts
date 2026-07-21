import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { FloorPlanId, TableId } from '@shared/domain/value-objects/identifiers.vo';
import { CLOCK } from '@modules/authentication/domain/tokens/authentication.tokens';
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
import { toTableResult } from '../mappers/table-result.mapper';
import { MoveTableCommand } from '../dto/move-table.command';
import { TableResult } from '../dto/table.result';

/**
 * Move Table (Phase 6.2 architecture decision, TASKS.md) - a dedicated
 * Domain Action reachable via the flat `POST /tables/:tableId/move` route.
 * Tenant validation walks Table -> Branch -> Restaurant, exactly like
 * `GetTableUseCase`/`UpdateTableUseCase`/`DeleteTableUseCase`. Changes ONLY
 * `floorPlanId` - never `status`, capacity, position, or any other field.
 * Produces a `table.moved` audit-log entry only; no domain event class
 * exists for this action (decision #7 of the Phase 6.2 note).
 */
@Injectable()
export class MoveTableUseCase {
  constructor(
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(FLOOR_PLAN_REPOSITORY) private readonly floorPlanRepository: FloorPlanRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
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
    const moved = existing.moveToFloorPlan(targetFloorPlanId.value, now);
    await this.tableRepository.save(moved);

    // Phase 6.2 decision #7: no TableMovedEvent - direct audit-log write
    // only, following UpdateRestaurantSettingsUseCase's own precedent.
    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'table.moved',
      targetType: 'Table',
      targetId: moved.tableId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    return toTableResult(moved);
  }
}
