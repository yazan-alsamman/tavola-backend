import { Injectable, Inject } from '@nestjs/common';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchRepository, BRANCH_REPOSITORY } from '../../domain/repositories/branch.repository';
import { BranchNotFoundException } from '../../domain/exceptions/branch-not-found.exception';
import { Branch } from '../../domain/entities/branch.entity';

/**
 * Tenant isolation gate for the per-branch use cases (ADR-051): resolves the
 * restaurant through the tenant-scoped RestaurantRepository, then checks the
 * branch belongs to it. Branch child tables carry no organizationId, so this
 * must run before any of them is read or written.
 */
@Injectable()
export class BranchAccessService {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
  ) {}

  async resolve(
    restaurantIdValue: string,
    branchIdValue: string,
  ): Promise<{ restaurant: Restaurant; branch: Branch }> {
    const restaurantId = RestaurantId.create(restaurantIdValue);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }
    const branch = await this.branchRepository.findByIdAndRestaurantId(
      BranchId.create(branchIdValue),
      restaurantId,
    );
    if (branch === null) {
      throw new BranchNotFoundException();
    }
    return { restaurant, branch };
  }
}
