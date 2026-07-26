import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PublishReservationReminderUseCase } from '@modules/reservations/application/use-cases/publish-reservation-reminder.use-case';
import { REMINDER_QUEUE_NAME, ReservationReminderJobData } from './reminder-queue.constants';

/**
 * Phase 7.6 (Operational Signals, ADR-019) - the sole consumer of
 * `ReminderQueue`. Delegates entirely to `PublishReservationReminderUseCase`,
 * which establishes Tenant Context from the job payload as its own first
 * line and is itself idempotent - this processor has no business logic of
 * its own, exactly like `ExpireReservationProcessor`'s own precedent.
 */
@Processor(REMINDER_QUEUE_NAME)
export class ReservationReminderProcessor extends WorkerHost {
  constructor(
    private readonly publishReservationReminderUseCase: PublishReservationReminderUseCase,
  ) {
    super();
  }

  async process(job: Job<ReservationReminderJobData>): Promise<void> {
    await this.publishReservationReminderUseCase.execute(job.data);
  }
}
