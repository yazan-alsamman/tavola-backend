import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import { ReservationId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CLOCK,
  ID_GENERATOR,
  EVENT_PUBLISHER,
  UNIT_OF_WORK,
} from '@modules/authentication/domain/tokens/authentication.tokens';
import {
  TableRepository,
  TABLE_REPOSITORY,
} from '@modules/tables/domain/repositories/table.repository';
import { TableNotFoundException } from '@modules/tables/domain/exceptions/table-not-found.exception';
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-settings.repository';
import { ReservationStatus } from '../../domain/enums/reservation.enums';
import { ReservationHistory } from '../../domain/entities/reservation-history.entity';
import { CancellationWindowService } from '../../domain/services/cancellation-window.service';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';
import { InvalidReservationStatusTransitionException } from '../../domain/exceptions/invalid-reservation-status-transition.exception';
import { ReservationCancelledEvent } from '../../domain/events/reservation.events';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';
import {
  ReservationHistoryRepository,
  RESERVATION_HISTORY_REPOSITORY,
} from '../../domain/repositories/reservation-history.repository';
import {
  assertActorCanModifyReservation,
  resolveActingId,
} from '../services/assert-actor-can-modify-reservation';
import {
  ReservationExpirationSchedulerPort,
  RESERVATION_EXPIRATION_SCHEDULER,
} from '../ports/reservation-expiration-scheduler.port';
import { toReservationResult } from '../mappers/reservation-result.mapper';
import { CancelReservationCommand } from '../dto/cancel-reservation.command';
import { ReservationResult } from '../dto/reservation.result';

/**
 * Phase 7.3 (Reservation Lifecycle, architecture frozen 2026-07-23). Reachable
 * from `Pending` or `Approved`, by either the reservation's own Customer or a
 * branch-scoped Employee holding `reservations:cancel` (resolved via
 * `assertActorCanModifyReservation` - one route, no new guard composition).
 * Never blocked by the cancellation window - only flagged on the resulting
 * `ReservationHistory` row. `Pending -> Cancelled` performs no Table
 * operation; `Approved -> Cancelled` calls `Table.release()` atomically with
 * the cancellation. No advisory lock is needed - Cancel never creates a new
 * confirmed occupancy of a table/window (ADR-013's phantom-insert race does
 * not apply); the conditional `WHERE status = ?` update is the sole
 * concurrency guard, exactly like Reject.
 */
@Injectable()
export class CancelReservationUseCase {
  constructor(
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(RESERVATION_HISTORY_REPOSITORY)
    private readonly reservationHistoryRepository: ReservationHistoryRepository,
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(RESTAURANT_SETTINGS_REPOSITORY)
    private readonly restaurantSettingsRepository: RestaurantSettingsRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(RESERVATION_EXPIRATION_SCHEDULER)
    private readonly expirationScheduler: ReservationExpirationSchedulerPort,
  ) {}

  async execute(command: CancelReservationCommand): Promise<ReservationResult> {
    const reservationId = ReservationId.create(command.reservationId);
    const existing = await this.reservationRepository.findById(reservationId);
    if (existing === null) {
      throw new ReservationNotFoundException();
    }
    assertActorCanModifyReservation(command.actor, existing, 'reservations:cancel');

    const now = this.clock.now();
    const sourceStatus = existing.status;
    const cancelled = existing.cancel(now);

    const settings = await this.restaurantSettingsRepository.findByRestaurantId(
      existing.restaurantId,
    );
    const cancellationWindowMinutes = settings?.cancellationWindowMinutes ?? 60;
    const withinCancellationWindow = CancellationWindowService.isWithinWindow(
      existing.reservationStartTime,
      cancellationWindowMinutes,
      now,
    );

    await this.unitOfWork.execute(async () => {
      const applied = await this.reservationRepository.updateTransitioningFrom(
        cancelled,
        sourceStatus,
      );
      if (!applied) {
        throw new InvalidReservationStatusTransitionException(
          `Cannot cancel reservation "${reservationId.value}" - it is no longer ${sourceStatus}.`,
        );
      }

      if (sourceStatus === ReservationStatus.Approved) {
        const table = await this.tableRepository.findById(existing.tableId);
        if (table === null) {
          throw new TableNotFoundException();
        }
        const releasedTable = table.release(now);
        await this.tableRepository.save(releasedTable);
      }

      await this.reservationHistoryRepository.save(
        ReservationHistory.create({
          id: this.idGenerator.generate(),
          reservationId: reservationId.value,
          oldStatus: sourceStatus,
          newStatus: ReservationStatus.Cancelled,
          oldReservationDate: null,
          oldReservationStartTime: null,
          newReservationDate: null,
          newReservationStartTime: null,
          oldTableId: null,
          newTableId: null,
          withinCancellationWindow,
          changedBy: resolveActingId(command.actor),
          changedAt: now,
          reason: command.reason,
        }),
      );
    });

    if (sourceStatus === ReservationStatus.Pending) {
      // Phase 7.3: no longer Pending - cancel its expiration job.
      await this.expirationScheduler.cancelExpiration(reservationId.value);
    }

    await this.eventPublisher.publish(
      new ReservationCancelledEvent(
        this.idGenerator.generate(),
        {
          reservationId: reservationId.value,
          restaurantId: existing.restaurantId.value,
          branchId: existing.branchId.value,
          tableId: existing.tableId.value,
          cancelledBy: resolveActingId(command.actor),
          withinCancellationWindow,
        },
        now,
        command.correlationId,
      ),
    );

    return toReservationResult(cancelled);
  }
}
