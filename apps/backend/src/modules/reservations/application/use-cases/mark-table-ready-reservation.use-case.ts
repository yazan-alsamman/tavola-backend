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
import { TableReadyNotifiedEvent } from '../../domain/events/reservation.events';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';
import { assertEmployeeCanActOnReservation } from '../services/assert-employee-reservation-scope';
import { toReservationResult } from '../mappers/reservation-result.mapper';
import { MarkTableReadyReservationCommand } from '../dto/mark-table-ready-reservation.command';
import { ReservationResult } from '../dto/reservation.result';

/**
 * Phase 7.6 (Operational Signals, ADR-019). Staff-initiated (`POST
 * /reservations/:id/table-ready`, `reservations:tableready`, staff-only,
 * exactly like Complete/NoShow's own `assertEmployeeCanActOnReservation`
 * scope check). Not a status transition - `status` remains `Approved` - so
 * unlike Complete/NoShow this performs no `Table` operation and needs no
 * `UnitOfWorkPort`/`ReservationHistory` row: the repository's own
 * single-column CAS (`markTableReadyNotifiedIfEligible`) is the sole write,
 * applied outside any transaction (mirrors the Late-Arrival job's own
 * CAS-only write). A `false` CAS result here (already Approved-left, or
 * already marked ready) is a genuine staff-facing error, not a silent
 * no-op - the direct HTTP caller expects to be told, unlike a background
 * sweep landing on a stale row.
 */
@Injectable()
export class MarkTableReadyReservationUseCase {
  constructor(
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: MarkTableReadyReservationCommand): Promise<ReservationResult> {
    const reservationId = ReservationId.create(command.reservationId);
    const existing = await this.reservationRepository.findById(reservationId);
    if (existing === null) {
      throw new ReservationNotFoundException();
    }
    assertEmployeeCanActOnReservation(command.actor, existing);

    const now = this.clock.now();
    // Validates the Approved-and-not-already-notified guard against the
    // in-memory snapshot before hitting the database, exactly like
    // `markLateArrivalNotified`'s own domain-layer pre-check - the
    // repository CAS below is the authoritative guard against a concurrent
    // writer, this is merely a fast, clear error for the common case.
    const markedReady = existing.markTableReadyNotified(now);

    const applied = await this.reservationRepository.markTableReadyNotifiedIfEligible(
      reservationId,
      now,
    );
    if (!applied) {
      throw new InvalidReservationStatusTransitionException(
        `Cannot mark reservation "${reservationId.value}" as table-ready - it is no longer Approved or has already been marked ready.`,
      );
    }

    await this.eventPublisher.publish(
      new TableReadyNotifiedEvent(
        this.idGenerator.generate(),
        {
          reservationId: reservationId.value,
          restaurantId: existing.restaurantId.value,
          branchId: existing.branchId.value,
          reservationStartTime: existing.reservationStartTime.toISOString(),
          tableReadyNotifiedAt: now.toISOString(),
          markedBy: command.actor.employeeId,
        },
        now,
        command.correlationId,
      ),
    );

    return toReservationResult(markedReady);
  }
}
