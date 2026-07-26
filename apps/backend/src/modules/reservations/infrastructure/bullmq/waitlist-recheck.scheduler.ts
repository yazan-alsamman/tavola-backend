import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { WaitlistRecheckSchedulerPort } from '@modules/reservations/application/ports/waitlist-recheck-scheduler.port';
import {
  RECHECK_WAITLIST_JOB_NAME,
  RecheckWaitlistJobData,
  WAITLIST_RECHECK_QUEUE_NAME,
} from '@shared/infrastructure/bullmq/waitlist-recheck-queue.constants';

/**
 * Phase 7.5 (Blocker B resolution) - the producer side of `WaitlistRecheckQueue`,
 * registered inside `ReservationsModule` (see that module's own doc comment
 * and `WAITLIST_RECHECK_QUEUE_NAME`'s doc comment for why this avoids
 * importing `WaitlistModule` directly). Deterministic `jobId` per
 * `(branchId, preferredDate)` - a duplicate trigger for the same queue scope
 * (e.g. Cancel and NoShow firing moments apart for the same branch/date)
 * collapses into one pending job rather than piling up duplicates, on top of
 * the claim-level idempotency `WaitlistPromotionService` already provides.
 */
@Injectable()
export class BullMqWaitlistRecheckScheduler implements WaitlistRecheckSchedulerPort {
  constructor(
    @InjectQueue(WAITLIST_RECHECK_QUEUE_NAME)
    private readonly queue: Queue<RecheckWaitlistJobData>,
  ) {}

  async enqueueRecheck(
    branchId: string,
    preferredDate: Date,
    organizationId: string | null,
    correlationId?: string,
  ): Promise<void> {
    const preferredDateIso = preferredDate.toISOString().slice(0, 10);
    const jobId = `waitlist-recheck-${branchId}-${preferredDateIso}`;
    await this.queue.add(
      RECHECK_WAITLIST_JOB_NAME,
      { branchId, preferredDateIso, organizationId, correlationId },
      { jobId, removeOnComplete: true, removeOnFail: true },
    );
  }
}
