import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { RecheckWaitlistUseCase } from '@modules/waitlist/application/use-cases/recheck-waitlist.use-case';
import {
  RecheckWaitlistJobData,
  WAITLIST_RECHECK_QUEUE_NAME,
} from '@shared/infrastructure/bullmq/waitlist-recheck-queue.constants';

/**
 * Phase 7.5 (Blocker B resolution) - the consumer side of
 * `WaitlistRecheckQueue`, registered inside `WaitlistModule` (see
 * `WAITLIST_RECHECK_QUEUE_NAME`'s own doc comment for why this and
 * `BullMqWaitlistRecheckScheduler` - registered in `ReservationsModule` -
 * are two independent producer/consumer registrations of the same named
 * queue, not a circular module import). Delegates entirely to
 * `RecheckWaitlistUseCase`, which is itself idempotent and establishes
 * Tenant Context from the job payload as its own first line.
 */
@Processor(WAITLIST_RECHECK_QUEUE_NAME)
export class WaitlistRecheckProcessor extends WorkerHost {
  constructor(private readonly recheckWaitlistUseCase: RecheckWaitlistUseCase) {
    super();
  }

  async process(job: Job<RecheckWaitlistJobData>): Promise<void> {
    await this.recheckWaitlistUseCase.execute(job.data);
  }
}
