import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ProcessLateArrivalUseCase } from '@modules/reservations/application/use-cases/process-late-arrival.use-case';
import { LATE_ARRIVAL_QUEUE_NAME, LateArrivalJobData } from './late-arrival-queue.constants';

/**
 * Phase 7.6 (Operational Signals, ADR-019) - the sole consumer of
 * `LateArrivalQueue`. Delegates entirely to `ProcessLateArrivalUseCase`,
 * which establishes Tenant Context from the job payload as its own first
 * line and is itself idempotent.
 */
@Processor(LATE_ARRIVAL_QUEUE_NAME)
export class LateArrivalProcessor extends WorkerHost {
  constructor(private readonly processLateArrivalUseCase: ProcessLateArrivalUseCase) {
    super();
  }

  async process(job: Job<LateArrivalJobData>): Promise<void> {
    await this.processLateArrivalUseCase.execute(job.data);
  }
}
