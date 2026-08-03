import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-settings.repository';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import {
  ReservationWaitlistEntryRepository,
  RESERVATION_WAITLIST_ENTRY_REPOSITORY,
} from '../../domain/repositories/reservation-waitlist-entry.repository';
import { WaitlistPromotionService } from '../services/waitlist-promotion.service';

export interface RecheckWaitlistInput {
  branchId: string;
  /** ISO date string (`YYYY-MM-DD`) - the queue scope to re-evaluate. */
  preferredDateIso: string;
  organizationId: string | null;
  correlationId?: string;
}

/**
 * Phase 7.5 architecture freeze items 6/8/11/12/13, refined by the final
 * FIFO-fairness decision (2026-07-24): FIFO-ORDERED FIRST-SERVICEABLE. An
 * unserviceable head-of-queue entry does not block the scan - entries are
 * evaluated strictly in `position` order and the FIRST one that is actually
 * serviceable is promoted; skipping an entry mutates nothing (no
 * Cancel/Expire/reorder). At most one successful promotion per re-check
 * (freeze item 7) - a later capacity-change signal may trigger another.
 * Invoked exclusively by `WaitlistRecheckProcessor` (the BullMQ consumer),
 * never by an HTTP controller. Best-effort by construction: every promotion
 * attempt is individually claim-guarded
 * (`WaitlistPromotionService.attemptPromotion`), so a retried/duplicate job
 * execution simply finds already-ineligible entries and no-ops on them -
 * this use case never throws for a "nothing to promote" outcome, only for a
 * genuine infrastructure failure (left to BullMQ's own retry/backoff).
 */
@Injectable()
export class RecheckWaitlistUseCase {
  constructor(
    @Inject(RESERVATION_WAITLIST_ENTRY_REPOSITORY)
    private readonly waitlistRepository: ReservationWaitlistEntryRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_SETTINGS_REPOSITORY)
    private readonly restaurantSettingsRepository: RestaurantSettingsRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    private readonly waitlistPromotionService: WaitlistPromotionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async execute(input: RecheckWaitlistInput): Promise<void> {
    await this.tenantContext.runAsync(
      {
        organizationId: input.organizationId,
        userId: null,
        correlationId: input.correlationId ?? `${input.branchId}:${input.preferredDateIso}`,
      },
      () => this.recheck(input),
    );
  }

  private async recheck(input: RecheckWaitlistInput): Promise<void> {
    const branchId = BranchId.create(input.branchId);
    const branch = await this.branchRepository.findById(branchId);
    if (branch === null) {
      // Branch soft-deleted/removed between the triggering event and this
      // job firing - nothing to re-check, safe no-op.
      return;
    }

    const settings = await this.restaurantSettingsRepository.findByRestaurantId(
      branch.restaurantId,
    );

    const preferredDate = new Date(`${input.preferredDateIso}T00:00:00.000Z`);
    const candidates = await this.waitlistRepository.findActiveByBranchAndDateOrderedByPosition(
      branchId,
      preferredDate,
    );

    const now = this.clock.now();
    for (const entry of candidates) {
      const outcome = await this.waitlistPromotionService.attemptPromotion({
        entry,
        branchTimezone: branch.timezone,
        reservationIntervalMinutes: settings?.reservationIntervalMinutes ?? 30,
        defaultReservationDurationMinutes: settings?.defaultReservationDurationMinutes ?? 90,
        autoApproval: settings?.autoApproval === true,
        promotedBy: null,
        now,
        correlationId: input.correlationId,
      });

      if (outcome.promoted) {
        // Phase 7.5 final FIFO-fairness decision item 7: stop after one
        // successful promotion per re-check attempt.
        return;
      }
      // Not serviceable or lost a claim race - continue scanning FIFO order
      // (do not block on this entry, do not mutate it).
    }
  }
}
