import { Injectable, Inject } from '@nestjs/common';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-settings.repository';
import {
  TableRepository,
  TABLE_REPOSITORY,
} from '@modules/tables/domain/repositories/table.repository';
import { TableMergeService } from '@modules/tables/domain/services/table-merge.service';
import { InvalidReservationTimeException } from '../../domain/exceptions/invalid-reservation-time.exception';
import { ReservationRepository } from '../../domain/repositories/reservation.repository';
import { RESERVATION_REPOSITORY } from '../../domain/repositories/reservation.repository';
import { SearchAvailabilityCommand } from '../dto/search-availability.command';
import { TableAvailabilityResult } from '../dto/table-availability.result';

/**
 * Phase 7.1 architecture decision (Availability Search Contract, TASKS.md
 * Phase 7.1 Architecture Freeze): informational only, never a conflict
 * check. Every `Available`-status table matching capacity is returned -
 * never hidden - each carrying an `isAvailable` indicator; a table already
 * holding a `Pending`/`Approved` reservation for the requested window is
 * still returned, marked unavailable rather than omitted. Customer-facing:
 * no tenant/organization scoping (Branch/Table are not
 * `DIRECT_TENANT_OWNED_MODELS`) - any authenticated actor may search any
 * branch, matching a public discovery capability, not an admin one.
 */
@Injectable()
export class SearchAvailabilityUseCase {
  constructor(
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservationRepository: ReservationRepository,
    @Inject(RESTAURANT_SETTINGS_REPOSITORY)
    private readonly restaurantSettingsRepository: RestaurantSettingsRepository,
  ) {}

  async execute(command: SearchAvailabilityCommand): Promise<TableAvailabilityResult[]> {
    const branchId = BranchId.create(command.branchId);

    const branch = await this.branchRepository.findById(branchId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    const startTime = new Date(command.reservationStartTime);
    if (Number.isNaN(startTime.getTime())) {
      throw new InvalidReservationTimeException('reservationStartTime is not a valid date-time.');
    }

    const endTime = await this.resolveEndTime(
      branch.restaurantId,
      startTime,
      command.reservationEndTime,
    );

    const tables = await this.tableRepository.findManyAvailableByBranchIdAndMinCapacity(
      branchId,
      command.partySize,
    );

    // One batched query for every candidate table's overlap check, instead
    // of one round-trip per table (this loop can otherwise scan a whole
    // branch's worth of Available tables).
    const overlappingReservations =
      await this.reservationRepository.findOverlappingPendingOrApprovedForTables(
        tables.map((table) => table.tableId),
        startTime,
        endTime,
      );
    const tableIdsWithOverlap = new Set(
      overlappingReservations.map((reservation) => reservation.tableId.value),
    );

    // Phase 15 (Optimization): one batched merge-group lookup for every
    // merge group referenced by `tables`, instead of one
    // `findManyByMergeGroupId` round-trip per merged table in the loop
    // below - this path can otherwise re-query a whole branch's worth of
    // merge groups on a customer-facing, unauthenticated hot path.
    const mergeGroupIds = tables
      .filter((table) => table.mergeGroupId !== null)
      .map((table) => table.mergeGroupId as string);
    const membersByGroup = await this.tableRepository.findManyByMergeGroupIds(mergeGroupIds);

    const results: TableAvailabilityResult[] = [];
    for (const table of tables) {
      // Phase 6 (Merge/Split Tables, ADR-026 decision #4/#14): `capacity`
      // in this informational, customer-facing response must reflect the
      // *effective* capacity - `findManyAvailableByBranchIdAndMinCapacity`
      // already filtered by it, so the displayed number must agree with why
      // this table was returned at all. `tables` only ever contains
      // `Available` rows, so a `mergeGroupId` here always means this table
      // is the group's Primary.
      const capacity =
        table.mergeGroupId !== null
          ? TableMergeService.computeEffectiveCapacity(membersByGroup.get(table.mergeGroupId) ?? [])
          : table.capacity;
      results.push({
        tableId: table.tableId.value,
        tableNumber: table.tableNumber,
        capacity,
        shape: table.shape,
        isAvailable: !tableIdsWithOverlap.has(table.tableId.value),
      });
    }

    return results;
  }

  private async resolveEndTime(
    restaurantId: RestaurantId,
    startTime: Date,
    clientEndTime?: string,
  ): Promise<Date> {
    if (clientEndTime !== undefined) {
      const endTime = new Date(clientEndTime);
      if (Number.isNaN(endTime.getTime())) {
        throw new InvalidReservationTimeException('reservationEndTime is not a valid date-time.');
      }
      if (endTime.getTime() <= startTime.getTime()) {
        throw new InvalidReservationTimeException(
          'reservationEndTime must be after reservationStartTime.',
        );
      }
      return endTime;
    }

    const settings = await this.restaurantSettingsRepository.findByRestaurantId(restaurantId);
    const durationMinutes = settings?.defaultReservationDurationMinutes ?? 90;
    return new Date(startTime.getTime() + durationMinutes * 60_000);
  }
}
