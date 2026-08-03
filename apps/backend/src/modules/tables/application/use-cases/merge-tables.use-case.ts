import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { TableId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '@modules/reservations/domain/repositories/reservation.repository';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { Table } from '../../domain/entities/table.entity';
import { TableRepository, TABLE_REPOSITORY } from '../../domain/repositories/table.repository';
import { TableMergeService } from '../../domain/services/table-merge.service';
import { TableNotFoundException } from '../../domain/exceptions/table-not-found.exception';
import { TableMergeConflictException } from '../../domain/exceptions/table-merge-conflict.exception';
import { TableMergedEvent } from '../../domain/events/table.events';
import {
  assertActorCanManageTables,
  resolveTableManagementActorId,
} from '../services/assert-actor-can-manage-tables';
import { toTableResult } from '../mappers/table-result.mapper';
import { MergeTablesCommand } from '../dto/merge-tables.command';
import { MergedUnitResult } from '../dto/merged-unit.result';

/**
 * Phase 6 (Merge/Split Tables, architecture frozen 2026-07-25, ADR-026).
 * Primary Table model (decision #1): every existing row keeps its own id and
 * permanent `capacity`; exactly one member becomes `isMergePrimary`, the
 * only `Table.id` future reservations against the merged unit ever target.
 *
 * Sequence: load the requested tables (any missing id -> 404, IDOR-safe) ->
 * resolve the owning Branch/Restaurant/Organization for every distinct
 * branch referenced and run dual-actor authorization
 * (`assertActorCanManageTables`) for each one -> only once every table is
 * confirmed to belong to an organization/branch the actor may manage,
 * validate the cross-table Merge rules (`TableMergeService.assertMergeable`,
 * same branch/floor plan, all `Available`, not already merged, >= 2
 * distinct) - this ordering keeps a foreign/out-of-scope table id
 * IDOR-safe (collapses to 404/403, never a state-disclosing 409) -> inside
 * one `UnitOfWorkPort` transaction: acquire sorted topology advisory locks
 * (ADR-026 decision #7), re-read, re-validate, reject if any component has a
 * blocking `Pending`/`Approved` reservation (decision #6), then mutate and
 * persist every member atomically. `TableMergedEvent` publishes only after
 * the transaction has committed.
 */
@Injectable()
export class MergeTablesUseCase {
  constructor(
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: MergeTablesCommand): Promise<MergedUnitResult> {
    const uniqueIdValues = [...new Set(command.tableIds)];
    const uniqueTableIds = uniqueIdValues.map((id) => TableId.create(id));

    const loadedUnique = await this.tableRepository.findManyByIds(uniqueTableIds);
    if (loadedUnique.length !== uniqueTableIds.length) {
      throw new TableNotFoundException();
    }
    const byId = new Map(loadedUnique.map((table) => [table.tableId.value, table]));

    // Authorize every distinct branch/organization referenced by the request
    // BEFORE any cross-table business-state validation
    // (`TableMergeService.assertMergeable` below) - a table from another
    // organization (or an out-of-scope branch) must collapse to the exact
    // same 404/403 a literally-nonexistent id produces, never a
    // distinguishing 409 that would disclose another tenant's table state.
    // Matches `assertActorCanManageTables`'s own IDOR-safe convention,
    // applied everywhere else in this codebase (e.g.
    // `assertActorCanModifyReservation`).
    let restaurant: Restaurant | null = null;
    const authorizedBranchIds = new Set<string>();
    for (const table of loadedUnique) {
      if (authorizedBranchIds.has(table.branchId.value)) {
        continue;
      }
      const branch = await this.branchRepository.findById(table.branchId);
      if (branch === null) {
        throw new TableNotFoundException();
      }
      restaurant = await this.restaurantRepository.findById(branch.restaurantId);
      if (restaurant === null) {
        throw new TableNotFoundException();
      }
      assertActorCanManageTables(command.actor, restaurant.organizationId.value, table.branchId);
      authorizedBranchIds.add(table.branchId.value);
    }
    if (restaurant === null) {
      throw new TableNotFoundException();
    }

    // Preserves the caller's original request length (including any
    // duplicate id) so `TableMergeService.assertMergeable`'s own duplicate
    // check actually has something to catch.
    const tablesInRequestOrder = command.tableIds.map((id) => byId.get(id)!);
    TableMergeService.assertMergeable(tablesInRequestOrder);

    const mergeGroupId = this.idGenerator.generate();
    const now = this.clock.now();
    let primary!: Table;
    let members: Table[] = [];

    await this.unitOfWork.execute(async () => {
      await this.tableRepository.acquireTopologyLocks(uniqueIdValues);

      const reloaded = await this.tableRepository.findManyByIds(uniqueTableIds);
      if (reloaded.length !== uniqueTableIds.length) {
        throw new TableNotFoundException();
      }
      TableMergeService.assertMergeable(reloaded);

      // Post-Audit Remediation (2026-08-02, L5): a single batched query
      // instead of one `hasBlockingReservation` call per table - the
      // topology locks above are already held, so this keeps lock hold
      // time constant regardless of merge-group size instead of linear.
      const blockedTableIds = new Set(
        (
          await this.reservationRepository.findBlockedTableIds(
            reloaded.map((table) => table.tableId),
            now,
          )
        ).map((id) => id.value),
      );
      const firstBlockedTable = reloaded.find((table) => blockedTableIds.has(table.tableId.value));
      if (firstBlockedTable !== undefined) {
        throw new TableMergeConflictException(
          `Table "${firstBlockedTable.tableId.value}" has a Pending/Approved reservation that has not ended yet - cannot merge.`,
        );
      }

      const selectedPrimaryId = TableMergeService.selectPrimary(reloaded, command.primaryTableId)
        .tableId.value;
      const updated = reloaded.map((table) =>
        table.tableId.value === selectedPrimaryId
          ? table.asMergePrimary(mergeGroupId, now)
          : table.asMergeSecondary(mergeGroupId, now),
      );
      await this.tableRepository.saveMany(updated);

      members = updated;
      primary = updated.find((table) => table.tableId.value === selectedPrimaryId)!;
    });

    const effectiveCapacity = TableMergeService.computeEffectiveCapacity(members);

    await this.eventPublisher.publish(
      new TableMergedEvent(
        this.idGenerator.generate(),
        {
          mergeGroupId,
          primaryTableId: primary.tableId.value,
          memberTableIds: members.map((table) => table.tableId.value),
          branchId: primary.branchId.value,
          floorPlanId: primary.floorPlanId.value,
          organizationId: restaurant.organizationId.value,
          effectiveCapacity,
          actorId: resolveTableManagementActorId(command.actor),
        },
        now,
        command.correlationId,
      ),
    );

    return {
      mergeGroupId,
      primaryTableId: primary.tableId.value,
      memberTableIds: members.map((table) => table.tableId.value),
      effectiveCapacity,
      primary: toTableResult(primary),
      members: members.map(toTableResult),
    };
  }
}
