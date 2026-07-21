import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { TableId } from '@shared/domain/value-objects/identifiers.vo';
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
import { TableNotFoundException } from '../../domain/exceptions/table-not-found.exception';
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
 * `Table.transitionStatus`, not duplicated here. Produces a
 * `table.status_changed` audit-log entry only; no domain event class exists
 * for this action (decision #7 of the Status Management note).
 */
@Injectable()
export class ChangeTableStatusUseCase {
  constructor(
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
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

    const now = this.clock.now();
    const transitioned = existing.transitionStatus(command.status, now);
    await this.tableRepository.save(transitioned);

    // Status Management decision #7: no domain event - direct audit-log
    // write only, following MoveTableUseCase's own precedent.
    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'table.status_changed',
      targetType: 'Table',
      targetId: transitioned.tableId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    return toTableResult(transitioned);
  }
}
