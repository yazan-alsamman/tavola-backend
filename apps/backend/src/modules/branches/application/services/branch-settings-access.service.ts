import { Injectable, Inject } from '@nestjs/common';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-settings.repository';
import { RestaurantSettings } from '@modules/restaurants/domain/entities/restaurant-settings.entity';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchSettingsResult } from '../dto/branch-settings.result';
import { BranchAccessService } from './branch-access.service';

/**
 * Shared gate for the branch settings use cases (ADR-051): checks the branch
 * belongs to a restaurant of the caller, then loads the rules the branch uses.
 */
@Injectable()
export class BranchSettingsAccessService {
  constructor(
    private readonly branchAccess: BranchAccessService,
    @Inject(RESTAURANT_SETTINGS_REPOSITORY)
    private readonly settingsRepository: RestaurantSettingsRepository,
  ) {}

  async load(
    restaurantIdValue: string,
    branchIdValue: string,
  ): Promise<{ branchId: BranchId; settings: RestaurantSettings }> {
    const { branch } = await this.branchAccess.resolve(restaurantIdValue, branchIdValue);
    const settings = await this.settingsRepository.findForBranch(
      RestaurantId.create(restaurantIdValue),
      branch.branchId,
    );
    if (settings === null) {
      throw new RestaurantNotFoundException();
    }
    return { branchId: branch.branchId, settings };
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
    autoApprovalMaxGuests: settings.autoApprovalMaxGuests,
    minLeadTimeMinutes: settings.minLeadTimeMinutes,
    maxDaysAhead: settings.maxDaysAhead,
    dailyGuestCap: settings.dailyGuestCap,
    updatedAt: settings.updatedAt,
  };
}
