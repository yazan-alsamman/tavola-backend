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

    const results: TableAvailabilityResult[] = [];
    for (const table of tables) {
      const overlapping = await this.reservationRepository.findOverlappingPendingOrApproved(
        table.tableId,
        startTime,
        endTime,
      );
      results.push({
        tableId: table.tableId.value,
        tableNumber: table.tableNumber,
        capacity: table.capacity,
        shape: table.shape,
        isAvailable: overlapping.length === 0,
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
