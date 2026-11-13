import { Injectable, Inject } from '@nestjs/common';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-settings.repository';
import { RestaurantSettings } from '@modules/restaurants/domain/entities/restaurant-settings.entity';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchRepository, BRANCH_REPOSITORY } from '../../domain/repositories/branch.repository';
import { BranchNotFoundException } from '../../domain/exceptions/branch-not-found.exception';
import { BranchSettingsResult } from '../dto/branch-settings.result';

/**
 * Shared gate for the branch settings use cases (ADR-051): resolves the
 * restaurant through the tenant-scoped repository, checks the branch belongs
 * to it, then loads the rules the branch uses.
 */
@Injectable()
export class BranchSettingsAccessService {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_SETTINGS_REPOSITORY)
    private readonly settingsRepository: RestaurantSettingsRepository,
  ) {}

  async load(
    restaurantIdValue: string,
    branchIdValue: string,
  ): Promise<{ branchId: BranchId; settings: RestaurantSettings }> {
    const restaurantId = RestaurantId.create(restaurantIdValue);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }
    const branchId = BranchId.create(branchIdValue);
    const branch = await this.branchRepository.findByIdAndRestaurantId(branchId, restaurantId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }
    const settings = await this.settingsRepository.findForBranch(restaurantId, branchId);
    if (settings === null) {
      throw new RestaurantNotFoundException();
    }
    return { branchId, settings };
  }
}

export function toBranchSettingsResult(
  branchId: BranchId,
  settings: RestaurantSettings,
): BranchSettingsResult {
  return {
    branchId: branchId.value,
    reservationIntervalMinutes: settings.reservationIntervalMinutes,
    maxGuestsPerReservation: settings.maxGuestsPerReservation,
    cancellationWindowMinutes: settings.cancellationWindowMinutes,
    pendingReservationTimeoutMinutes: settings.pendingReservationTimeoutMinutes,
    defaultReservationDurationMinutes: settings.defaultReservationDurationMinutes,
    autoApproval: settings.autoApproval,
    reservationReminderMinutesBefore: settings.reservationReminderMinutesBefore,
    lateArrivalGraceMinutes: settings.lateArrivalGraceMinutes,
    updatedAt: settings.updatedAt,
  };
}
