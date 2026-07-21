import { Injectable, Inject } from '@nestjs/common';
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
import { toTableResult } from '../mappers/table-result.mapper';
import { GetTableCommand } from '../dto/get-table.command';
import { TableResult } from '../dto/table.result';

/**
 * Flat route (`GET /tables/:tableId`, TASKS.md Phase 6.1 Routing decision) -
 * no `restaurantId`/`branchId` in the URL, so tenant validation walks the
 * relation chain upward from the Table row itself: Table -> Branch ->
 * Restaurant (the last hop IS tenant-scoped via `RestaurantRepository`,
 * TENANCY.md). Any missing link (table/branch/restaurant, or a
 * restaurant belonging to another organization) collapses to the same
 * `TableNotFoundException` - never distinguishing which hop failed, the same
 * IDOR-safe pattern `findByIdAndRestaurantId`/`findByIdAndBranchId` use
 * elsewhere via a compound query.
 */
@Injectable()
export class GetTableUseCase {
  constructor(
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
  ) {}

  async execute(command: GetTableCommand): Promise<TableResult> {
    const table = await this.tableRepository.findById(TableId.create(command.tableId));
    if (table === null) {
      throw new TableNotFoundException();
    }

    const branch = await this.branchRepository.findById(table.branchId);
    if (branch === null) {
      throw new TableNotFoundException();
    }

    const restaurant = await this.restaurantRepository.findById(branch.restaurantId);
    if (restaurant === null) {
      throw new TableNotFoundException();
    }

    return toTableResult(table);
  }
}
