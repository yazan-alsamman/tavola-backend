import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  assertActorCanViewAnalytics,
  assertActorCanViewOrganizationAnalytics,
  resolveEffectiveBranchIdFilter,
} from './assert-actor-can-view-analytics';

export interface ResolvedRestaurantScope {
  restaurantId: string;
  branchIds: string[] | null;
}

export interface ResolvedBranchScope {
  restaurantId: string;
  branchId: string;
  timezone: string;
}

export interface ResolvedOrganizationScope {
  restaurantIds: string[];
}

const ORGANIZATION_SCOPE_PAGE_SIZE = 100;

/**
 * Phase 14 (Analytics, ADR-028). Shared tenant-resolution + dual-actor
 * authorization for every Analytics use case - mirrors `CreateBranchUseCase`'s
 * "tenant isolation gate" (resolve the parent Restaurant through the
 * tenant-scoped `RestaurantRepository` first) combined with
 * `assertActorCanViewAnalytics`'s use-case-level dual-actor branching.
 */
@Injectable()
export class ResolveAnalyticsScopeService {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
  ) {}

  /** Restaurant-scope routes (optionally narrowed to one Branch via `branchIdRaw`). */
  async resolveRestaurantScope(
    actor: AuthenticatedActor,
    restaurantIdRaw: string,
    branchIdRaw: string | undefined,
  ): Promise<ResolvedRestaurantScope> {
    const restaurantId = RestaurantId.create(restaurantIdRaw);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    let branchId: BranchId | null = null;
    if (branchIdRaw !== undefined) {
      branchId = BranchId.create(branchIdRaw);
      const branch = await this.branchRepository.findByIdAndRestaurantId(
        branchId,
        restaurant.restaurantId,
      );
      if (branch === null) {
        throw new BranchNotFoundException();
      }
    }

    assertActorCanViewAnalytics(actor, restaurant.restaurantId.value, branchId);

    return {
      restaurantId: restaurant.restaurantId.value,
      branchIds: branchId ? [branchId.value] : resolveEffectiveBranchIdFilter(actor),
    };
  }

  /** Branch-scope routes (Peak Hours, trends) - a single Branch is mandatory. */
  async resolveBranchScope(
    actor: AuthenticatedActor,
    restaurantIdRaw: string,
    branchIdRaw: string,
  ): Promise<ResolvedBranchScope> {
    const restaurantId = RestaurantId.create(restaurantIdRaw);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const branchId = BranchId.create(branchIdRaw);
    const branch = await this.branchRepository.findByIdAndRestaurantId(
      branchId,
      restaurant.restaurantId,
    );
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    assertActorCanViewAnalytics(actor, restaurant.restaurantId.value, branchId);

    return {
      restaurantId: restaurant.restaurantId.value,
      branchId: branch.branchId.value,
      timezone: branch.timezone,
    };
  }

  /**
   * Organization-scope route - Owner/Admin only (ADR-028 Decision #6).
   * Aggregates every Restaurant the tenant-scoped `RestaurantRepository`
   * resolves for the caller's organization (no `organizationId` route
   * parameter anywhere in this codebase - it always comes from the JWT via
   * `TenantContextService`, matching `RestaurantsController`'s own `GET
   * /restaurants` precedent).
   */
  async resolveOrganizationScope(actor: AuthenticatedActor): Promise<ResolvedOrganizationScope> {
    assertActorCanViewOrganizationAnalytics(actor);

    const restaurantIds: string[] = [];
    let page = 1;
    for (;;) {
      const pageResult = await this.restaurantRepository.findMany(
        page,
        ORGANIZATION_SCOPE_PAGE_SIZE,
      );
      restaurantIds.push(...pageResult.items.map((restaurant) => restaurant.restaurantId.value));
      if (restaurantIds.length >= pageResult.total || pageResult.items.length === 0) {
        break;
      }
      page += 1;
    }
    return { restaurantIds };
  }
}
