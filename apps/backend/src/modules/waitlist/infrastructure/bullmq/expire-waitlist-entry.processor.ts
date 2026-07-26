import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ExpireWaitlistEntryUseCase } from '@modules/waitlist/application/use-cases/expire-waitlist-entry.use-case';
import { ExpireWaitlistEntryJobData, WAITLIST_QUEUE_NAME } from './waitlist-queue.constants';

/**
 * Phase 7.5 - the sole consumer of `WaitlistQueue`'s expiration jobs.
 * Delegates entirely to `ExpireWaitlistEntryUseCase`, which establishes
 * Tenant Context from the job payload as its own first line and is itself
 * idempotent.
 */
@Processor(WAITLIST_QUEUE_NAME)
export class ExpireWaitlistEntryProcessor extends WorkerHost {
  constructor(private readonly expireWaitlistEntryUseCase: ExpireWaitlistEntryUseCase) {
    super();
  }

  async process(job: Job<ExpireWaitlistEntryJobData>): Promise<void> {
    await this.expireWaitlistEntryUseCase.execute(job.data);
  }
}
