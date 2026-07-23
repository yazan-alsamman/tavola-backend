import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import { ReservationId, TableId } from '@shared/domain/value-objects/identifiers.vo';
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
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationStatus } from '../../domain/enums/reservation.enums';
import { ReservationHistory } from '../../domain/entities/reservation-history.entity';
import { ReservationAvailabilityService } from '../../domain/services/reservation-availability.service';
import { CancellationWindowService } from '../../domain/services/cancellation-window.service';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';
import { InvalidReservationException } from '../../domain/exceptions/invalid-reservation.exception';
import { InvalidReservationTimeException } from '../../domain/exceptions/invalid-reservation-time.exception';
import { InvalidReservationStatusTransitionException } from '../../domain/exceptions/invalid-reservation-status-transition.exception';
import { ReservationConflictException } from '../../domain/exceptions/reservation-conflict.exception';
import { ReservationRescheduleWindowExpiredException } from '../../domain/exceptions/reservation-reschedule-window-expired.exception';
import {
  ReservationRejectedEvent,
  ReservationRescheduledEvent,
} from '../../domain/events/reservation.events';
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
import { AutoRejectOverlappingPendingReservationsService } from '../services/auto-reject-overlapping-pending-reservations.service';
import {
  ReservationExpirationSchedulerPort,
  RESERVATION_EXPIRATION_SCHEDULER,
} from '../ports/reservation-expiration-scheduler.port';
import { toReservationResult } from '../mappers/reservation-result.mapper';
import { RescheduleReservationCommand } from '../dto/reschedule-reservation.command';
import { ReservationResult } from '../dto/reservation.result';

/**
 * Phase 7.3 (Reservation Lifecycle, architecture frozen 2026-07-23) +
 * ADR-023. Reschedule is an in-place modification (never a status
 * transition), reachable from `Pending` or `Approved`, by either the
 * reservation's own Customer or a branch-scoped Employee holding
 * `reservations:reschedule`. May change `tableId`/`reservationStartTime`/
 * `reservationEndTime`/`guests` together, restricted to another Table within
 * the same Branch. Blocked outright once the cancellation window before the
 * *current* scheduled time has closed (`ReservationRescheduleWindowExpiredException`)
 * - the opposite of Cancel, which is never blocked.
 *
 * Concurrency (ADR-023): a `Pending` reschedule (same or different table)
 * needs only the single new-window lock key, matching Create/Approve. An
 * `Approved` reschedule to the *same* table also needs only that one key -
 * the table stays continuously `Reserved`, no release/re-reserve cycle. An
 * `Approved` reschedule to a *different* table acquires both the old and
 * new lock keys in deterministic lexicographic order (never caller-dependent),
 * inside one transaction: release the old Table, reserve the new one,
 * update the Reservation, persist `ReservationHistory`, and auto-reject any
 * other overlapping Pending reservation for the new table/window (Decision
 * G - reusing Phase 7.2's own mechanism) - all atomic, or none of it happens.
 */
@Injectable()
export class RescheduleReservationUseCase {
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
    private readonly autoRejectOverlappingPendingReservations: AutoRejectOverlappingPendingReservationsService,
  ) {}

  async execute(command: RescheduleReservationCommand): Promise<ReservationResult> {
    const reservationId = ReservationId.create(command.reservationId);
    const existing = await this.reservationRepository.findById(reservationId);
    if (existing === null) {
      throw new ReservationNotFoundException();
    }
    assertActorCanModifyReservation(command.actor, existing, 'reservations:reschedule');

    if (
      command.tableId === undefined &&
      command.reservationStartTime === undefined &&
      command.reservationEndTime === undefined &&
      command.guests === undefined
    ) {
      throw new InvalidReservationException(
        'At least one of tableId, reservationStartTime, reservationEndTime, or guests must be supplied to reschedule.',
      );
    }

    const settings = await this.restaurantSettingsRepository.findByRestaurantId(
      existing.restaurantId,
    );
    const cancellationWindowMinutes = settings?.cancellationWindowMinutes ?? 60;
    const reservationIntervalMinutes = settings?.reservationIntervalMinutes ?? 30;

    const now = this.clock.now();
    if (
      CancellationWindowService.isWithinWindow(
        existing.reservationStartTime,
        cancellationWindowMinutes,
        now,
      )
    ) {
      throw new ReservationRescheduleWindowExpiredException();
    }

    const targetStartTime = this.resolveTime(
      command.reservationStartTime,
      existing.reservationStartTime,
    );
    const targetEndTime = this.resolveTime(command.reservationEndTime, existing.reservationEndTime);
    const targetGuests = command.guests ?? existing.guests;

    const targetTable = await this.tableRepository.findByIdAndBranchId(
      TableId.create(command.tableId ?? existing.tableId.value),
      existing.branchId,
    );
    if (targetTable === null) {
      throw new TableNotFoundException();
    }
    const tableChanged = targetTable.tableId.value !== existing.tableId.value;

    const reservationDate = new Date(
      Date.UTC(
        targetStartTime.getUTCFullYear(),
        targetStartTime.getUTCMonth(),
        targetStartTime.getUTCDate(),
      ),
    );

    const sourceStatus = existing.status;
    const rescheduled = existing.reschedule({
      tableId: targetTable.tableId.value,
      reservationDate,
      reservationStartTime: targetStartTime,
      reservationEndTime: targetEndTime,
      guests: targetGuests,
      tableCapacity: targetTable.capacity,
      now,
    });

    const newTimeSlotBucket = ReservationAvailabilityService.deriveTimeSlotBucket(
      targetStartTime,
      reservationIntervalMinutes,
    );
    const newLockKey = ReservationAvailabilityService.deriveLockKey(
      existing.branchId.value,
      targetTable.tableId.value,
      reservationDate,
      newTimeSlotBucket,
    );

    let autoRejected: Reservation[] = [];

    await this.unitOfWork.execute(async () => {
      if (sourceStatus === ReservationStatus.Approved && tableChanged) {
        // ADR-023: two lock keys, deterministic sorted order - never
        // caller-dependent - so two concurrent reschedules moving in
        // opposite directions between the same two tables cannot deadlock.
        const oldTimeSlotBucket = ReservationAvailabilityService.deriveTimeSlotBucket(
          existing.reservationStartTime,
          reservationIntervalMinutes,
        );
        const oldLockKey = ReservationAvailabilityService.deriveLockKey(
          existing.branchId.value,
          existing.tableId.value,
          existing.reservationDate,
          oldTimeSlotBucket,
        );
        const [firstKey, secondKey] = [oldLockKey, newLockKey].sort();
        await this.reservationRepository.acquireAdvisoryLock(firstKey);
        await this.reservationRepository.acquireAdvisoryLock(secondKey);
      } else {
        await this.reservationRepository.acquireAdvisoryLock(newLockKey);
      }

      const conflict = await this.reservationRepository.findConfirmedOverlapExcluding(
        targetTable.tableId,
        targetStartTime,
        targetEndTime,
        reservationId,
      );
      if (conflict !== null) {
        throw new ReservationConflictException();
      }

      const applied = await this.reservationRepository.updateTransitioningFrom(
        rescheduled,
        sourceStatus,
      );
      if (!applied) {
        throw new InvalidReservationStatusTransitionException(
          `Cannot reschedule reservation "${reservationId.value}" - it is no longer ${sourceStatus}.`,
        );
      }

      if (sourceStatus === ReservationStatus.Approved) {
        if (tableChanged) {
          const oldTable = await this.tableRepository.findById(existing.tableId);
          if (oldTable === null) {
            throw new TableNotFoundException();
          }
          const releasedOldTable = oldTable.release(now);
          await this.tableRepository.save(releasedOldTable);

          const reservedNewTable = targetTable.reserve(reservationId.value, now);
          await this.tableRepository.save(reservedNewTable);
        }
        // Same-table Approved reschedule: the table stays continuously
        // Reserved - no release()/reserve() cycle (would create an
        // unnecessary transient un-reserved state).

        const systemNote = `Automatically rejected: the table was rescheduled for reservation ${reservationId.value}, which overlaps this reservation's requested time window.`;
        autoRejected = await this.autoRejectOverlappingPendingReservations.execute(
          targetTable.tableId,
          targetStartTime,
          targetEndTime,
          reservationId,
          now,
          systemNote,
        );
      }
      // Pending reschedule (same or different table): no Table operation at
      // all - a Pending reservation never reserves a table.

      await this.reservationHistoryRepository.save(
        ReservationHistory.create({
          id: this.idGenerator.generate(),
          reservationId: reservationId.value,
          oldStatus: sourceStatus,
          newStatus: sourceStatus,
          oldReservationDate: existing.reservationDate,
          oldReservationStartTime: existing.reservationStartTime,
          newReservationDate: reservationDate,
          newReservationStartTime: targetStartTime,
          oldTableId: tableChanged ? existing.tableId.value : null,
          newTableId: tableChanged ? targetTable.tableId.value : null,
          withinCancellationWindow: false,
          changedBy: resolveActingId(command.actor),
          changedAt: now,
          reason: null,
        }),
      );
    });

    if (sourceStatus === ReservationStatus.Pending) {
      // Phase 7.3: the expiration formula ("reservationStartTime +
      // pendingReservationTimeoutMinutes") depends on the reservation's own
      // start time - reschedule the delayed job to match the new window
      // rather than leaving it pointed at the old one.
      const pendingReservationTimeoutMinutes = settings?.pendingReservationTimeoutMinutes ?? 15;
      const expireAt = new Date(
        targetStartTime.getTime() + pendingReservationTimeoutMinutes * 60_000,
      );
      await this.expirationScheduler.scheduleExpiration(
        reservationId.value,
        null,
        expireAt,
        command.correlationId,
      );
    }

    for (const rejected of autoRejected) {
      await this.expirationScheduler.cancelExpiration(rejected.reservationId.value);
    }

    await this.eventPublisher.publish(
      new ReservationRescheduledEvent(
        this.idGenerator.generate(),
        {
          reservationId: reservationId.value,
          restaurantId: existing.restaurantId.value,
          branchId: existing.branchId.value,
          oldTableId: existing.tableId.value,
          newTableId: targetTable.tableId.value,
          rescheduledBy: resolveActingId(command.actor),
        },
        now,
        command.correlationId,
      ),
    );

    for (const rejected of autoRejected) {
      await this.eventPublisher.publish(
        new ReservationRejectedEvent(
          this.idGenerator.generate(),
          {
            reservationId: rejected.reservationId.value,
            restaurantId: rejected.restaurantId.value,
            branchId: rejected.branchId.value,
            tableId: rejected.tableId.value,
            rejectedBy: null,
            automatic: true,
          },
          now,
          command.correlationId,
        ),
      );
    }

    return toReservationResult(rescheduled);
  }

  private resolveTime(clientValue: string | undefined, currentValue: Date): Date {
    if (clientValue === undefined) {
      return currentValue;
    }
    const parsed = new Date(clientValue);
    if (Number.isNaN(parsed.getTime())) {
      throw new InvalidReservationTimeException(`"${clientValue}" is not a valid date-time.`);
    }
    return parsed;
  }
}
