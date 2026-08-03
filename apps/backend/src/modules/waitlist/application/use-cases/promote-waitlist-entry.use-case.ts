import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-settings.repository';
import { WaitlistEntryNotFoundException } from '../../domain/exceptions/waitlist-entry-not-found.exception';
import { InvalidWaitlistStatusTransitionException } from '../../domain/exceptions/invalid-waitlist-status-transition.exception';
import { NoTableAvailableForPromotionException } from '../../domain/exceptions/no-table-available-for-promotion.exception';
import {
  ReservationWaitlistEntryRepository,
  RESERVATION_WAITLIST_ENTRY_REPOSITORY,
} from '../../domain/repositories/reservation-waitlist-entry.repository';
import { assertEmployeeCanActOnWaitlistEntry } from '../services/assert-actor-can-modify-waitlist-entry';
import { WaitlistPromotionService } from '../services/waitlist-promotion.service';
import { toWaitlistEntryResult } from '../mappers/waitlist-entry-result.mapper';
import { PromoteWaitlistEntryCommand } from '../dto/promote-waitlist-entry.command';
import { WaitlistEntryResult } from '../dto/waitlist-entry.result';

/**
 * Phase 7.5 architecture freeze item 7/8/10 (`POST /waitlist/:id/promote`) -
 * staff-only manual trigger. Uses the identical slot-derivation and
 * table-search as automatic promotion (Phase 7.5 final promotion-slot-
 * semantics decision) - the Employee supplies no start/end time; if the
 * entry cannot currently be promoted for its own requested slot, this fails
 * safely and leaves the entry unchanged (freeze item 8's own instruction).
 */
@Injectable()
export class PromoteWaitlistEntryUseCase {
  constructor(
    @Inject(RESERVATION_WAITLIST_ENTRY_REPOSITORY)
    private readonly waitlistRepository: ReservationWaitlistEntryRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_SETTINGS_REPOSITORY)
    private readonly restaurantSettingsRepository: RestaurantSettingsRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    private readonly waitlistPromotionService: WaitlistPromotionService,
  ) {}

  async execute(command: PromoteWaitlistEntryCommand): Promise<WaitlistEntryResult> {
    const existing = await this.waitlistRepository.findById(command.entryId);
    if (existing === null) {
      throw new WaitlistEntryNotFoundException();
    }
    assertEmployeeCanActOnWaitlistEntry(command.actor, existing);

    const branch = await this.branchRepository.findById(existing.branchId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }
    const settings = await this.restaurantSettingsRepository.findByRestaurantId(
      existing.restaurantId,
    );

    const now = this.clock.now();
    const outcome = await this.waitlistPromotionService.attemptPromotion({
      entry: existing,
      branchTimezone: branch.timezone,
      reservationIntervalMinutes: settings?.reservationIntervalMinutes ?? 30,
      defaultReservationDurationMinutes: settings?.defaultReservationDurationMinutes ?? 90,
      autoApproval: settings?.autoApproval === true,
      promotedBy: command.actor.employeeId,
      now,
      correlationId: command.correlationId,
    });

    if (!outcome.promoted) {
      if (outcome.reason === 'lost-claim-race') {
        throw new InvalidWaitlistStatusTransitionException(
          `Cannot promote waitlist entry "${command.entryId}" - it is no longer eligible.`,
        );
      }
      throw new NoTableAvailableForPromotionException();
    }

    const promoted = await this.waitlistRepository.findById(command.entryId);
    if (promoted === null) {
      throw new WaitlistEntryNotFoundException();
    }
    return toWaitlistEntryResult(promoted);
  }
}
