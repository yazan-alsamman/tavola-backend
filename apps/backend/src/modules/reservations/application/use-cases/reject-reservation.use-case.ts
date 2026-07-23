import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { ReservationId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CLOCK,
  ID_GENERATOR,
  EVENT_PUBLISHER,
} from '@modules/authentication/domain/tokens/authentication.tokens';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';
import { InvalidReservationStatusTransitionException } from '../../domain/exceptions/invalid-reservation-status-transition.exception';
import { ReservationRejectedEvent } from '../../domain/events/reservation.events';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';
import { assertEmployeeCanActOnReservation } from '../services/assert-employee-reservation-scope';
import {
  ReservationExpirationSchedulerPort,
  RESERVATION_EXPIRATION_SCHEDULER,
} from '../ports/reservation-expiration-scheduler.port';
import { toReservationResult } from '../mappers/reservation-result.mapper';
import { RejectReservationCommand } from '../dto/reject-reservation.command';
import { ReservationResult } from '../dto/reservation.result';

/**
 * Phase 7.2 (Approval Workflow, architecture frozen 2026-07-20). Manual
 * Reject only - only a `Pending` reservation may be rejected. CRITICAL, per
 * TASKS.md's "Phase 7.2 — Approval Workflow: Architecture Correction": this
 * use case performs NO `Table` operation whatsoever - it has no
 * `TableRepository` dependency at all, structurally guaranteeing
 * `Table.release()` is never called here (a reservation can only be
 * rejected while still `Pending`, and a `Pending` reservation never called
 * `Table.reserve()` in the first place, so there is nothing to release). No
 * advisory lock is needed either - rejecting an existing row is a single
 * conditional update, not a phantom-insert race (ADR-013 is scoped to
 * insert/approve, both of which create a NEW confirmed occupancy of a
 * table/window; Reject removes a Pending row from contention instead).
 */
@Injectable()
export class RejectReservationUseCase {
  constructor(
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(RESERVATION_EXPIRATION_SCHEDULER)
    private readonly expirationScheduler: ReservationExpirationSchedulerPort,
  ) {}

  async execute(command: RejectReservationCommand): Promise<ReservationResult> {
    const reservationId = ReservationId.create(command.reservationId);
    const existing = await this.reservationRepository.findById(reservationId);
    if (existing === null) {
      throw new ReservationNotFoundException();
    }
    assertEmployeeCanActOnReservation(command.actor, existing);

    const now = this.clock.now();
    const rejected = existing.reject(now);

    // Database-level conditional update (ADR-013's own recommended
    // optimistic-locking technique for update/approval operations) - the
    // authoritative, race-safe gate against a concurrent Approve/Reject of
    // the same reservation.
    const applied = await this.reservationRepository.updateTransitioningFromPending(rejected);
    if (!applied) {
      throw new InvalidReservationStatusTransitionException(
        `Cannot reject reservation "${reservationId.value}" - it is no longer Pending.`,
      );
    }

    // Phase 7.3: no longer Pending - cancel its expiration job (safe no-op
    // if none exists).
    await this.expirationScheduler.cancelExpiration(reservationId.value);

    await this.eventPublisher.publish(
      new ReservationRejectedEvent(
        this.idGenerator.generate(),
        {
          reservationId: reservationId.value,
          restaurantId: existing.restaurantId.value,
          branchId: existing.branchId.value,
          tableId: existing.tableId.value,
          rejectedBy: command.actor.employeeId,
          automatic: false,
        },
        now,
        command.correlationId,
      ),
    );

    return toReservationResult(rejected);
  }
}
