import { Injectable, Inject } from '@nestjs/common';
import { ReservationId, TableId } from '@shared/domain/value-objects/identifiers.vo';
import { Reservation } from '../../domain/entities/reservation.entity';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';

/**
 * Shared by `ApproveReservationUseCase` (Phase 7.2) and
 * `RescheduleReservationUseCase` (Phase 7.3, Decision G) - the identical
 * "an Approved reservation wins the slot, no Table operation for the
 * rejected ones" mechanism DOMAIN_MODEL.md defines once and both use cases
 * trigger. Extracted here (not duplicated) once Phase 7.3 needed the exact
 * same logic a second time. Must be called from inside the caller's own
 * `UnitOfWorkPort` transaction, alongside the Approval/Reschedule write it
 * accompanies.
 */
@Injectable()
export class AutoRejectOverlappingPendingReservationsService {
  constructor(
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
  ) {}

  async execute(
    tableId: TableId,
    startTime: Date,
    endTime: Date,
    excludeReservationId: ReservationId,
    now: Date,
    systemNote: string,
  ): Promise<Reservation[]> {
    const candidates = await this.reservationRepository.findOtherOverlappingPending(
      tableId,
      startTime,
      endTime,
      excludeReservationId,
    );

    const rejected: Reservation[] = [];
    for (const candidate of candidates) {
      const autoRejected = candidate.autoReject(now, systemNote);
      const applied = await this.reservationRepository.updateTransitioningFromPending(autoRejected);
      if (applied) {
        rejected.push(autoRejected);
      }
    }
    return rejected;
  }
}
