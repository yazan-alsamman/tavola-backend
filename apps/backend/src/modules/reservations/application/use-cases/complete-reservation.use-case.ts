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
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { Reservation } from '../../domain/entities/reservation.entity';
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
import {
  assertActorCanOperateReservation,
  resolveReservationOperatorId,
} from '../services/assert-employee-reservation-scope';
import { ScheduleApprovedReservationSignalsService } from '../services/schedule-approved-reservation-signals.service';
import { toReservationResult } from '../mappers/reservation-result.mapper';
import { CompleteReservationCommand } from '../dto/complete-reservation.command';
import { ReservationResult } from '../dto/reservation.result';
import { releaseReservationTable } from '../services/release-reservation-table';

/**
 * Phase 7.3 (Reservation Lifecycle, architecture frozen 2026-07-23).
 * `Approved -> Completed` only. Owner/Admin of the owning organization, or
 * an Employee holding `reservations:complete` and branch scope. Only
 * reachable once the reservation's scheduled service window has begun
 * (enforced by `Reservation.complete()` itself). Calls `Table.release()`
 * atomically with the transition, returning the table directly to
 * `Available` - never through `Cleaning`. No advisory lock needed (same
 * reasoning as Cancel/Reject - no new confirmed occupancy is created).
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
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
  ) {}

  async execute(command: CompleteReservationCommand): Promise<ReservationResult> {
    const reservationId = ReservationId.create(command.reservationId);
    const existing = await this.reservationRepository.findById(reservationId);
    if (existing === null) {
      throw new ReservationNotFoundException();
    }
    await assertActorCanOperateReservation(
      command.actor,
      existing,
      'reservations:complete',
      this.restaurantRepository,
    );
    const operatorId = resolveReservationOperatorId(command.actor);
    const completed = await this.applyCompletion(existing, operatorId, command.correlationId);
    return toReservationResult(completed);
  }

  /**
   * CR WJ-R-2026-002 round 2 - the auto-close sweep's entry point
   * (`AutoCloseOverdueReservationsUseCase`): the same `Approved ->
   * Completed` transition, table release and event as a staff completion,
   * recorded with no operator (`changedBy`/`completedBy` null), which is how
   * the dashboard tells a table the system closed apart from one staff
   * closed. Returns `false`, never throws, when the reservation is gone or
   * no longer Approved - a concurrent staff action simply wins.
   */
  async executeAsSystem(reservationId: string, correlationId?: string): Promise<boolean> {
    const existing = await this.reservationRepository.findById(ReservationId.create(reservationId));
    if (existing === null || existing.status !== ReservationStatus.Approved) {
      return false;
    }
    try {
      await this.applyCompletion(existing, null, correlationId);
      return true;
    } catch (error) {
      if (error instanceof InvalidReservationStatusTransitionException) {
        return false;
      }
      throw error;
    }
  }

  private async applyCompletion(
    existing: Reservation,
    operatorId: string | null,
    correlationId: string | undefined,
  ): Promise<Reservation> {
    const reservationId = existing.reservationId;
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

      await releaseReservationTable(this.tableRepository, existing.tableId, now);

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
          changedBy: operatorId,
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
          completedBy: operatorId,
        },
        now,
        correlationId,
      ),
    );

    return completed;
  }
}
