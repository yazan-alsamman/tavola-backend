import { Processor, WorkerHost } from '@nestjs/bullmq';
import { AutoCloseOverdueReservationsUseCase } from '@modules/reservations/application/use-cases/auto-close-overdue-reservations.use-case';
import { AUTO_CLOSE_QUEUE_NAME } from './auto-close-queue.constants';

/** Sole consumer of `ReservationAutoCloseQueue`; no business logic of its own. */
@Processor(AUTO_CLOSE_QUEUE_NAME)
export class AutoCloseProcessor extends WorkerHost {
  constructor(private readonly autoCloseOverdueReservations: AutoCloseOverdueReservationsUseCase) {
    super();
  }

  async process(): Promise<{ closed: number }> {
    return this.autoCloseOverdueReservations.execute();
  }
}
