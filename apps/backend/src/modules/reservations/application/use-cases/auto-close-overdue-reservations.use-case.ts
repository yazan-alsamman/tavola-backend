import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';
import { CompleteReservationUseCase } from './complete-reservation.use-case';

/**
 * How long after a confirmed booking's scheduled end the system waits
 * before closing it on staff's behalf. The dashboard shows "closes
 * automatically soon" during this window, so reception gets a warning first.
 */
export const AUTO_CLOSE_GRACE_MINUTES = 30;

/** Upper bound per sweep so one run never holds the worker for long. */
export const AUTO_CLOSE_BATCH_SIZE = 200;

export interface AutoCloseOverdueReservationsResult {
  closed: number;
}

/**
 * CR WJ-R-2026-002 round 2 - closes `Approved` reservations that reception
 * forgot to close: once `reservationEndTime` plus
 * {@link AUTO_CLOSE_GRACE_MINUTES} has passed, the booking is completed as
 * the System (no operator) and its table released. The dashboard's daily
 * auto-closed report lists exactly these (Completed with `changedBy` null).
 * Each reservation goes through `CompleteReservationUseCase.executeAsSystem`,
 * so there is one completion path, and a reservation a staff member closes
 * at the same moment is skipped, not double-processed. Run by the
 * recurring `ReservationAutoCloseQueue` job.
 */
@Injectable()
export class AutoCloseOverdueReservationsUseCase {
  private readonly logger = new Logger(AutoCloseOverdueReservationsUseCase.name);

  constructor(
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    private readonly completeReservationUseCase: CompleteReservationUseCase,
    private readonly tenantContext: TenantContextService,
  ) {}

  async execute(): Promise<AutoCloseOverdueReservationsResult> {
    const cutoff = new Date(this.clock.now().getTime() - AUTO_CLOSE_GRACE_MINUTES * 60_000);
    const ids = await this.tenantContext.runAsync(
      { organizationId: null, userId: null, correlationId: 'auto-close-sweep' },
      () => this.reservationRepository.findOverdueApprovedIds(cutoff, AUTO_CLOSE_BATCH_SIZE),
    );

    let closed = 0;
    for (const id of ids) {
      try {
        const done = await this.tenantContext.runAsync(
          { organizationId: null, userId: null, correlationId: id.value },
          () => this.completeReservationUseCase.executeAsSystem(id.value, id.value),
        );
        if (done) closed += 1;
      } catch (error) {
        // One broken row (e.g. its table was removed) must not stop the sweep.
        this.logger.error(
          `Auto-close failed for reservation ${id.value}: ${(error as Error).message}`,
        );
      }
    }
    return { closed };
  }
}
