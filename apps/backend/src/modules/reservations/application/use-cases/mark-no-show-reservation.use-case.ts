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
import { ReservationStatus } from '../../domain/enums/reservation.enums';
import { ReservationHistory } from '../../domain/entities/reservation-history.entity';
import { ReservationNotFoundException } from '../../domain/exceptions/reservation-not-found.exception';
import { InvalidReservationStatusTransitionException } from '../../domain/exceptions/invalid-reservation-status-transition.exception';
import { ReservationNoShowEvent } from '../../domain/events/reservation.events';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';
import {
  ReservationHistoryRepository,
  RESERVATION_HISTORY_REPOSITORY,
} from '../../domain/repositories/reservation-history.repository';
import { assertEmployeeCanActOnReservation } from '../services/assert-employee-reservation-scope';
import { toReservationResult } from '../mappers/reservation-result.mapper';
import { MarkNoShowReservationCommand } from '../dto/mark-no-show-reservation.command';
import { ReservationResult } from '../dto/reservation.result';

/**
 * Phase 7.3 (Reservation Lifecycle, architecture frozen 2026-07-23).
 * `Approved -> NoShow` only, staff-only (`reservations:noshow` - a
 * dedicated slug, never a reuse of `reservations:approve`). Only reachable
 * once the reservation's scheduled time has passed (enforced by
 * `Reservation.markNoShow()` itself). Calls `Table.release()` atomically,
 * identically to Complete. No-show customer restriction/counting policy
 * remains a deferred future product decision - out of scope here.
 */
@Injectable()
export class MarkNoShowReservationUseCase {
  constructor(
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(RESERVATION_HISTORY_REPOSITORY)
    private readonly reservationHistoryRepository: ReservationHistoryRepository,
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: MarkNoShowReservationCommand): Promise<ReservationResult> {
    const reservationId = ReservationId.create(command.reservationId);
    const existing = await this.reservationRepository.findById(reservationId);
    if (existing === null) {
      throw new ReservationNotFoundException();
    }
    assertEmployeeCanActOnReservation(command.actor, existing);

    const now = this.clock.now();
    const markedNoShow = existing.markNoShow(now);

    await this.unitOfWork.execute(async () => {
      const applied = await this.reservationRepository.updateTransitioningFrom(
        markedNoShow,
        ReservationStatus.Approved,
      );
      if (!applied) {
        throw new InvalidReservationStatusTransitionException(
          `Cannot mark reservation "${reservationId.value}" as NoShow - it is no longer Approved.`,
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
          newStatus: ReservationStatus.NoShow,
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

    await this.eventPublisher.publish(
      new ReservationNoShowEvent(
        this.idGenerator.generate(),
        {
          reservationId: reservationId.value,
          restaurantId: existing.restaurantId.value,
          branchId: existing.branchId.value,
          tableId: existing.tableId.value,
          markedBy: command.actor.employeeId,
        },
        now,
        command.correlationId,
      ),
    );

    return toReservationResult(markedNoShow);
  }
}
