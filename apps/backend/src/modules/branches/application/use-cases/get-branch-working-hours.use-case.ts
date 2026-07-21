import { Injectable, Inject } from '@nestjs/common';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchRepository, BRANCH_REPOSITORY } from '../../domain/repositories/branch.repository';
import { BranchNotFoundException } from '../../domain/exceptions/branch-not-found.exception';
import {
  BranchWorkingHoursRepository,
  BRANCH_WORKING_HOURS_REPOSITORY,
} from '../../domain/repositories/branch-working-hours.repository';
import { toBranchWorkingHoursResult } from '../mappers/branch-working-hours-result.mapper';
import { GetBranchWorkingHoursCommand } from '../dto/get-branch-working-hours.command';
import { BranchWorkingHoursResult } from '../dto/branch-working-hours.result';

@Injectable()
export class GetBranchWorkingHoursUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(BRANCH_WORKING_HOURS_REPOSITORY)
    private readonly branchWorkingHoursRepository: BranchWorkingHoursRepository,
  ) {}

  async execute(command: GetBranchWorkingHoursCommand): Promise<BranchWorkingHoursResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate: BranchWorkingHours carries no organizationId of
    // its own (TENANCY.md's "transitively tenant-owned" case) - resolving the
    // parent Restaurant through the already-tenant-scoped RestaurantRepository
    // first is what makes this call safe.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    // IDOR/existence gate: the branch must exist and belong to this restaurant.
    const branchId = BranchId.create(command.branchId);
    const branch = await this.branchRepository.findByIdAndRestaurantId(branchId, restaurantId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    const entries = await this.branchWorkingHoursRepository.findAllByBranchId(branchId);
    return toBranchWorkingHoursResult(branchId.value, entries);
  }
}
