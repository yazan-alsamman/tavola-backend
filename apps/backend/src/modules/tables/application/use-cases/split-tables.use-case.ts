import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import { TableId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CLOCK,
  ID_GENERATOR,
  EVENT_PUBLISHER,
  UNIT_OF_WORK,
} from '@modules/authentication/domain/tokens/authentication.tokens';
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
import { Table } from '../../domain/entities/table.entity';
import { TableRepository, TABLE_REPOSITORY } from '../../domain/repositories/table.repository';
import { TableMergeService } from '../../domain/services/table-merge.service';
import { TableNotFoundException } from '../../domain/exceptions/table-not-found.exception';
import { TableNotMergedException } from '../../domain/exceptions/table-not-merged.exception';
import { TableMergeConflictException } from '../../domain/exceptions/table-merge-conflict.exception';
import { TableSplitEvent } from '../../domain/events/table.events';
import {
  assertActorCanManageTables,
  resolveTableManagementActorId,
} from '../services/assert-actor-can-manage-tables';
import { toTableResult } from '../mappers/table-result.mapper';
import { SplitTablesCommand } from '../dto/split-tables.command';
import { MergedUnitResult } from '../dto/merged-unit.result';

/**
 * Phase 6 (Merge/Split Tables, architecture frozen 2026-07-25, ADR-026
 * decision #2). "Split = undo merge only" - no new Table rows are ever
 * created or destroyed, and permanent `capacity`/`Table.id`s are never
 * touched. `tableId` may be ANY member of the active merge group (ADR-026
 * decision #9) - the full group is resolved from whichever id is given.
 *
 * Sequence: load the target table (404 if unknown) -> resolve the owning
 * Branch/Restaurant/Organization and run dual-actor authorization
 * (`assertActorCanManageTables`) -> only once authorized, check
 * `TableNotMergedException` if it isn't currently merged -> load every
 * member of its group (this ordering keeps a foreign/out-of-scope table id
 * IDOR-safe - collapses to 404/403, never a response that discloses whether
 * some other tenant's table happens to be merged) -> inside one `UnitOfWorkPort` transaction:
 * acquire sorted topology advisory locks (ADR-026 decision #7), re-read,
 * re-check the group is still intact, reject if the PRIMARY has a blocking
 * `Pending`/`Approved` reservation (decision #6 - Split only ever blocks on
 * the primary, unlike Merge which blocks on every component), then clear
 * every member's merge membership and persist atomically.
 * `TableSplitEvent` publishes only after the transaction has committed.
 */
@Injectable()
export class SplitTablesUseCase {
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

  async execute(command: SplitTablesCommand): Promise<MergedUnitResult> {
    const tableId = TableId.create(command.tableId);
    const target = await this.tableRepository.findById(tableId);
    if (target === null) {
      throw new TableNotFoundException();
    }

    // Authorize BEFORE any business-state validation
    // (`target.mergeGroupId`/primary-membership checks below) - an
    // unauthorized or cross-tenant table id must collapse to the exact same
    // 404/403 a literally-nonexistent id produces, never a distinguishing
    // response that discloses whether some other tenant's table happens to
    // be merged right now. Matches `assertActorCanManageTables`'s own
    // IDOR-safe convention, applied everywhere else in this codebase (e.g.
    // `assertActorCanModifyReservation`), and `MergeTablesUseCase`'s own
    // identical fix.
    const branch = await this.branchRepository.findById(target.branchId);
    if (branch === null) {
      throw new TableNotFoundException();
    }
    const restaurant = await this.restaurantRepository.findById(branch.restaurantId);
    if (restaurant === null) {
      throw new TableNotFoundException();
    }
    assertActorCanManageTables(command.actor, restaurant.organizationId.value, target.branchId);

    if (target.mergeGroupId === null) {
      throw new TableNotMergedException();
    }
    const mergeGroupId = target.mergeGroupId;

    const members = await this.tableRepository.findManyByMergeGroupId(mergeGroupId);
    const primaryBeforeSplit = members.find((table) => table.isMergePrimary);
    if (primaryBeforeSplit === undefined) {
      throw new TableMergeConflictException(
        `Merge group "${mergeGroupId}" has no primary table - cannot split.`,
      );
    }

    const now = this.clock.now();
    const effectiveCapacity = TableMergeService.computeEffectiveCapacity(members);
    let cleared: Table[] = [];

    await this.unitOfWork.execute(async () => {
      const memberIds = members.map((table) => table.tableId.value);
      await this.tableRepository.acquireTopologyLocks(memberIds);

      const reloadedMembers = await this.tableRepository.findManyByMergeGroupId(mergeGroupId);
      if (reloadedMembers.length === 0) {
        throw new TableNotMergedException();
      }
      const reloadedPrimary = reloadedMembers.find((table) => table.isMergePrimary);
      if (reloadedPrimary === undefined) {
        throw new TableMergeConflictException(
          `Merge group "${mergeGroupId}" has no primary table - cannot split.`,
        );
      }

      const blocked = await this.reservationRepository.hasBlockingReservation(
        reloadedPrimary.tableId,
        now,
      );
      if (blocked) {
        throw new TableMergeConflictException(
          `Table "${reloadedPrimary.tableId.value}" has a Pending/Approved reservation that has not ended yet - cannot split.`,
        );
      }

      cleared = reloadedMembers.map((table) => table.clearMergeMembership(now));
      await this.tableRepository.saveMany(cleared);
    });

    await this.eventPublisher.publish(
      new TableSplitEvent(
        this.idGenerator.generate(),
        {
          mergeGroupId,
          primaryTableId: primaryBeforeSplit.tableId.value,
          memberTableIds: members.map((table) => table.tableId.value),
          branchId: target.branchId.value,
          floorPlanId: target.floorPlanId.value,
          organizationId: restaurant.organizationId.value,
          actorId: resolveTableManagementActorId(command.actor),
        },
        now,
        command.correlationId,
      ),
    );

    const clearedPrimary = cleared.find(
      (table) => table.tableId.value === primaryBeforeSplit.tableId.value,
    )!;

    return {
      mergeGroupId,
      primaryTableId: primaryBeforeSplit.tableId.value,
      memberTableIds: members.map((table) => table.tableId.value),
      effectiveCapacity,
      primary: toTableResult(clearedPrimary),
      members: cleared.map(toTableResult),
    };
  }
}
