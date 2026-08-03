import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { ReservationId } from '@shared/domain/value-objects/identifiers.vo';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { ReservationStatus } from '../../domain/enums/reservation.enums';
import { ReservationHistory } from '../../domain/entities/reservation-history.entity';
import { ReservationExpiredEvent } from '../../domain/events/reservation.events';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';
import {
  ReservationHistoryRepository,
  RESERVATION_HISTORY_REPOSITORY,
} from '../../domain/repositories/reservation-history.repository';

export interface ExpirePendingReservationInput {
  reservationId: string;
  organizationId: string | null;
  correlationId?: string;
}

/**
 * Phase 7.3 (Reservation Lifecycle, architecture frozen 2026-07-23) -
 * `Pending -> Expired` only (`Approved -> Expired` does not exist in the
 * frozen state machine). Invoked exclusively by `ExpireReservationProcessor`
 * (the BullMQ job handler), never by an HTTP controller - there is no public
 * expiration endpoint. Idempotent: if the reservation is no longer `Pending`
 * by the time the delayed job fires (already Approved/Rejected/Cancelled, or
 * already expired by a previous, retried execution of this same job), this
 * is a safe no-op. Performs no `Table` operation - a `Pending` reservation
 * never reserved a table. CODING_STANDARDS.md requires establishing Tenant
 * Context from the job payload as the first line of the handler - done here
 * via `TenantContextService.runAsync`, not in the Processor, so this use
 * case remains directly unit-testable without a real BullMQ job object.
 */
@Injectable()
export class ExpirePendingReservationUseCase {
  constructor(
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(RESERVATION_HISTORY_REPOSITORY)
    private readonly reservationHistoryRepository: ReservationHistoryRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    private readonly tenantContext: TenantContextService,
  ) {}

  async execute(input: ExpirePendingReservationInput): Promise<void> {
    await this.tenantContext.runAsync(
      {
        organizationId: input.organizationId,
        userId: null,
        correlationId: input.correlationId ?? input.reservationId,
      },
      () => this.expire(input),
    );
  }

  private async expire(input: ExpirePendingReservationInput): Promise<void> {
    const reservationId = ReservationId.create(input.reservationId);
    const existing = await this.reservationRepository.findById(reservationId);
    if (existing === null || existing.status !== ReservationStatus.Pending) {
      return;
    }

    const now = this.clock.now();
    const expired = existing.expire(now);

    let applied = false;
    await this.unitOfWork.execute(async () => {
      applied = await this.reservationRepository.updateTransitioningFrom(
        expired,
        ReservationStatus.Pending,
      );
      if (!applied) {
        return;
      }

      await this.reservationHistoryRepository.save(
        ReservationHistory.create({
          id: this.idGenerator.generate(),
          reservationId: reservationId.value,
          oldStatus: ReservationStatus.Pending,
          newStatus: ReservationStatus.Expired,
          oldReservationDate: null,
          oldReservationStartTime: null,
          newReservationDate: null,
          newReservationStartTime: null,
          oldTableId: null,
          newTableId: null,
          withinCancellationWindow: null,
          changedBy: null,
          changedAt: now,
          reason: null,
        }),
      );
    });

    if (!applied) {
      return;
    }

    await this.eventPublisher.publish(
      new ReservationExpiredEvent(
        this.idGenerator.generate(),
        {
          reservationId: reservationId.value,
          restaurantId: existing.restaurantId.value,
          branchId: existing.branchId.value,
          tableId: existing.tableId.value,
        },
        now,
        input.correlationId,
      ),
    );
  }
}
