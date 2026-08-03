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
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-settings.repository';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationAvailabilityService } from '../../domain/services/reservation-availability.service';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';
import { InvalidReservationStatusTransitionException } from '../../domain/exceptions/invalid-reservation-status-transition.exception';
import { ReservationConflictException } from '../../domain/exceptions/reservation-conflict.exception';
import {
  ReservationApprovedEvent,
  ReservationRejectedEvent,
} from '../../domain/events/reservation.events';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';
import { assertEmployeeCanActOnReservation } from '../services/assert-employee-reservation-scope';
import { AutoRejectOverlappingPendingReservationsService } from '../services/auto-reject-overlapping-pending-reservations.service';
import {
  ReservationExpirationSchedulerPort,
  RESERVATION_EXPIRATION_SCHEDULER,
} from '../ports/reservation-expiration-scheduler.port';
import { ScheduleApprovedReservationSignalsService } from '../services/schedule-approved-reservation-signals.service';
import { toReservationResult } from '../mappers/reservation-result.mapper';
import { ApproveReservationCommand } from '../dto/approve-reservation.command';
import { ReservationResult } from '../dto/reservation.result';

/**
 * Phase 7.2 (Approval Workflow, architecture frozen 2026-07-20). Manual
 * Approve path only - the auto-approval branch of Create Reservation uses
 * `Reservation.createAutoApproved()` instead and never reaches this use
 * case. ADR-013 governs Approval identically to Create ("Before inserting a
 * new Reservation (or approving a Pending one)... calls
 * pg_advisory_xact_lock... inside the same transaction as the availability
 * check and insert" - the readiness report's "ADR-013 remains scoped to
 * Create only" was a documented discrepancy, corrected here): the advisory
 * lock, the confirmed-overlap re-check, the conditional
 * `WHERE status = Pending` update (ADR-013's own recommended secondary
 * optimistic-locking technique for update/approval operations), the
 * `Table.reserve()` call, and the auto-rejection of every other overlapping
 * `Pending` reservation for the same table all happen inside one
 * `UnitOfWorkPort` transaction - one atomic unit, matching decision #6's
 * "Table.reserve()... call inside the same advisory-locked transaction as
 * the reservation write" (DECISIONS.md ADR-013 Impact amendment).
 */
@Injectable()
export class ApproveReservationUseCase {
  constructor(
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
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
    private readonly scheduleApprovedReservationSignals: ScheduleApprovedReservationSignalsService,
  ) {}

  async execute(command: ApproveReservationCommand): Promise<ReservationResult> {
    const reservationId = ReservationId.create(command.reservationId);
    const existing = await this.reservationRepository.findById(reservationId);
    if (existing === null) {
      throw new ReservationNotFoundException();
    }
    assertEmployeeCanActOnReservation(command.actor, existing);

    const now = this.clock.now();
    // Entity-level snapshot guard - the first, cheaper line of defense
    // against approving a reservation that is no longer Pending. The
    // database-level conditional update below is the authoritative,
    // race-safe gate (ADR-013).
    const approved = existing.approve(command.actor.employeeId, now);

    const settings = await this.restaurantSettingsRepository.findByRestaurantId(
      existing.restaurantId,
    );
    const reservationIntervalMinutes = settings?.reservationIntervalMinutes ?? 30;
    const timeSlotBucket = ReservationAvailabilityService.deriveTimeSlotBucket(
      existing.reservationStartTime,
      reservationIntervalMinutes,
    );
    const lockKey = ReservationAvailabilityService.deriveLockKey(
      existing.branchId.value,
      existing.tableId.value,
      existing.reservationDate,
      timeSlotBucket,
    );

    let autoRejected: Reservation[] = [];

    await this.unitOfWork.execute(async () => {
      // ADR-026 decision #7 "Compatibility with ADR-013/023": the topology
      // lock is acquired BEFORE the ADR-013 slot lock, in the same
      // transaction that will call `Table.reserve()` below - a concurrent
      // Merge/Split on this table can never race Approve.
      await this.tableRepository.acquireTopologyLocks([existing.tableId.value]);

      // ADR-013 mechanics #1: lock first, then re-check, then write.
      await this.reservationRepository.acquireAdvisoryLock(lockKey);

      const conflict = await this.reservationRepository.findConfirmedOverlapExcluding(
        existing.tableId,
        existing.reservationStartTime,
        existing.reservationEndTime,
        reservationId,
      );
      if (conflict !== null) {
        throw new ReservationConflictException();
      }

      const applied = await this.reservationRepository.updateTransitioningFromPending(approved);
      if (!applied) {
        throw new InvalidReservationStatusTransitionException(
          `Cannot approve reservation "${reservationId.value}" - it is no longer Pending.`,
        );
      }

      const table = await this.tableRepository.findById(existing.tableId);
      if (table === null) {
        throw new TableNotFoundException();
      }
      const reservedTable = table.reserve(reservationId.value, now);
      await this.tableRepository.save(reservedTable);

      // DOMAIN_MODEL.md: "approving the first automatically rejects any
      // other pending reservation whose time window overlaps the same
      // table... Neither manual nor automatic rejection performs any Table
      // operation." A candidate already moved away from Pending by a
      // concurrent request is silently skipped by the shared service - it
      // converged to the correct end state via another path, not an error.
      const systemNote = `Automatically rejected: the table was approved for reservation ${reservationId.value}, which overlaps this reservation's requested time window.`;
      autoRejected = await this.autoRejectOverlappingPendingReservations.execute(
        existing.tableId,
        existing.reservationStartTime,
        existing.reservationEndTime,
        reservationId,
        now,
        systemNote,
      );
    });

    // Phase 7.3: the approved reservation (and every auto-rejected one) is
    // no longer Pending - cancel their expiration jobs (a safe no-op if none
    // exists). External I/O, so only after the transaction has committed.
    await this.expirationScheduler.cancelExpiration(reservationId.value);

    // Phase 7.6 (Operational Signals, ADR-019): the reservation is now
    // Approved - schedule both the Reminder and Late-Arrival BullMQ jobs.
    // External I/O, so only after the transaction has committed.
    await this.scheduleApprovedReservationSignals.scheduleForApproved(
      approved,
      command.correlationId,
    );

    await this.eventPublisher.publish(
      new ReservationApprovedEvent(
        this.idGenerator.generate(),
        {
          reservationId: reservationId.value,
          restaurantId: existing.restaurantId.value,
          branchId: existing.branchId.value,
          tableId: existing.tableId.value,
          approvedBy: command.actor.employeeId,
          automatic: false,
        },
        now,
        command.correlationId,
      ),
    );

    for (const rejected of autoRejected) {
      await this.expirationScheduler.cancelExpiration(rejected.reservationId.value);
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

    return toReservationResult(approved);
  }
}
