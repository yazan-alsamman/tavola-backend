import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ExpirePendingReservationUseCase } from '@modules/reservations/application/use-cases/expire-pending-reservation.use-case';
import { ExpireReservationJobData, RESERVATION_QUEUE_NAME } from './reservation-queue.constants';

/**
 * Phase 7.3 (Reservation Lifecycle) - the sole consumer of `ReservationQueue`.
 * Delegates entirely to `ExpirePendingReservationUseCase`, which establishes
 * Tenant Context from the job payload as its own first line
 * (CODING_STANDARDS.md) and is itself idempotent - this processor has no
 * business logic of its own.
 */
@Processor(RESERVATION_QUEUE_NAME)
export class ExpireReservationProcessor extends WorkerHost {
  constructor(private readonly expirePendingReservationUseCase: ExpirePendingReservationUseCase) {
    super();
  }

  async process(job: Job<ExpireReservationJobData>): Promise<void> {
    await this.expirePendingReservationUseCase.execute(job.data);
  }
}
