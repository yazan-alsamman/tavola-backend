import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { WaitlistExpirationSchedulerPort } from '@modules/waitlist/application/ports/waitlist-expiration-scheduler.port';
import {
  EXPIRE_WAITLIST_ENTRY_JOB_NAME,
  ExpireWaitlistEntryJobData,
  WAITLIST_QUEUE_NAME,
} from './waitlist-queue.constants';

/**
 * Phase 7.5 - direct structural mirror of
 * `BullMqReservationExpirationScheduler` (Phase 7.3 precedent). Always
 * removes any existing job for the same entry first, so re-scheduling
 * replaces rather than duplicates the delayed job.
 */
@Injectable()
export class BullMqWaitlistExpirationScheduler implements WaitlistExpirationSchedulerPort {
  constructor(
    @InjectQueue(WAITLIST_QUEUE_NAME)
    private readonly queue: Queue<ExpireWaitlistEntryJobData>,
  ) {}

  async scheduleExpiration(
    entryId: string,
    organizationId: string | null,
    expiresAt: Date,
    correlationId?: string,
  ): Promise<void> {
    const jobId = this.jobId(entryId);
    await this.queue.remove(jobId);
    const delay = Math.max(0, expiresAt.getTime() - Date.now());
    await this.queue.add(
      EXPIRE_WAITLIST_ENTRY_JOB_NAME,
      { entryId, organizationId, correlationId },
      { jobId, delay, removeOnComplete: true, removeOnFail: true },
    );
  }

  async cancelExpiration(entryId: string): Promise<void> {
    await this.queue.remove(this.jobId(entryId));
  }

  private jobId(entryId: string): string {
    // BullMQ rejects a custom job id containing `:` - `-` avoids the same
    // pitfall Phase 7.3 hit and documented.
    return `expire-waitlist-${entryId}`;
  }
}
