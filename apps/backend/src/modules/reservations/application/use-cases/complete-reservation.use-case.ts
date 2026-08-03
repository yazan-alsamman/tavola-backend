import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { ReservationId } from '@shared/domain/value-objects/identifiers.vo';
import {
  TableRepository,
  TABLE_REPOSITORY,
} from '@modules/tables/domain/repositories/table.repository';
import { TableNotFoundException } from '@modules/tables/domain/exceptions/table-not-found.exception';
import { ReservationStatus } from '../../domain/enums/reservation.enums';
import { ReservationHistory } from '../../domain/entities/reservation-history.entity';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';
import { InvalidReservationStatusTransitionException } from '../../domain/exceptions/invalid-reservation-status-transition.exception';
import { ReservationCompletedEvent } from '../../domain/events/reservation.events';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';
import {
  ReservationHistoryRepository,
  RESERVATION_HISTORY_REPOSITORY,
} from '../../domain/repositories/reservation-history.repository';
import { assertEmployeeCanActOnReservation } from '../services/assert-employee-reservation-scope';
import { ScheduleApprovedReservationSignalsService } from '../services/schedule-approved-reservation-signals.service';
import { toReservationResult } from '../mappers/reservation-result.mapper';
import { CompleteReservationCommand } from '../dto/complete-reservation.command';
import { ReservationResult } from '../dto/reservation.result';

/**
 * Phase 7.3 (Reservation Lifecycle, architecture frozen 2026-07-23).
 * `Approved -> Completed` only, staff-only (`reservations:complete`,
 * `PermissionsGuard` + branch scope at the controller/use-case layer,
 * exactly like Approve/Reject). Only reachable once the reservation's
 * scheduled service window has begun (enforced by `Reservation.complete()`
 * itself). Calls `Table.release()` atomically with the transition, returning
 * the table directly to `Available` - never through `Cleaning`. No advisory
 * lock needed (same reasoning as Cancel/Reject - no new confirmed occupancy
 * is created).
 */
@Injectable()
export class CompleteReservationUseCase {
  constructor(
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(RESERVATION_HISTORY_REPOSITORY)
    private readonly reservationHistoryRepository: ReservationHistoryRepository,
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    private readonly scheduleApprovedReservationSignals: ScheduleApprovedReservationSignalsService,
  ) {}

  async execute(command: CompleteReservationCommand): Promise<ReservationResult> {
    const reservationId = ReservationId.create(command.reservationId);
    const existing = await this.reservationRepository.findById(reservationId);
    if (existing === null) {
      throw new ReservationNotFoundException();
    }
    assertEmployeeCanActOnReservation(command.actor, existing);

    const now = this.clock.now();
    const completed = existing.complete(now);

    await this.unitOfWork.execute(async () => {
      const applied = await this.reservationRepository.updateTransitioningFrom(
        completed,
        ReservationStatus.Approved,
      );
      if (!applied) {
        throw new InvalidReservationStatusTransitionException(
          `Cannot complete reservation "${reservationId.value}" - it is no longer Approved.`,
        );
      }

      const table = await this.tableRepository.findById(existing.tableId);
      if (table === null) {
        throw new TableNotFoundException();
      }
      const releasedTable = table.release(now);
      await this.tableRepository.save(releasedTable);

      await this.reservationHistoryRepository.save(
        ReservationHistory.create({
          id: this.idGenerator.generate(),
          reservationId: reservationId.value,
          oldStatus: ReservationStatus.Approved,
          newStatus: ReservationStatus.Completed,
          oldReservationDate: null,
          oldReservationStartTime: null,
          newReservationDate: null,
          newReservationStartTime: null,
          oldTableId: null,
          newTableId: null,
          withinCancellationWindow: null,
          changedBy: command.actor.employeeId,
          changedAt: now,
          reason: null,
        }),
      );
    });

    // Phase 7.6 (Operational Signals, ADR-019): Completed is only reachable
    // from Approved, so this always fires - cancels both the Reminder and
    // Late-Arrival jobs.
    await this.scheduleApprovedReservationSignals.cancelForReservation(reservationId.value);

    await this.eventPublisher.publish(
      new ReservationCompletedEvent(
        this.idGenerator.generate(),
        {
          reservationId: reservationId.value,
          restaurantId: existing.restaurantId.value,
          branchId: existing.branchId.value,
          tableId: existing.tableId.value,
          completedBy: command.actor.employeeId,
        },
        now,
        command.correlationId,
      ),
    );

    return toReservationResult(completed);
  }
}
