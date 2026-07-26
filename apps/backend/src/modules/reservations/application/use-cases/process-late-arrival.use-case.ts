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
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { ReservationStatus } from '../../domain/enums/reservation.enums';
import { GuestLateArrivalNotifiedEvent } from '../../domain/events/reservation.events';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';
import { LateArrivalJobData } from '../../infrastructure/bullmq/late-arrival-queue.constants';

/**
 * Phase 7.6 (Operational Signals, ADR-019) - the `LateArrivalQueue` job's
 * sole business logic, invoked exclusively by `LateArrivalProcessor`. Writes
 * exactly one column via `ReservationRepository.markLateArrivalNotifiedIfEligible`'s
 * database-level CAS (`WHERE status = 'Approved' AND late_arrival_notified_at
 * IS NULL`) - the authoritative concurrency guard against duplicate workers.
 *
 * Stale-job protection mirrors `PublishReservationReminderUseCase`: before the
 * CAS, the reservation must still be `Approved` **and**
 * `reservationStartTime` must still match the job payload. Without the
 * start-time check, an Approved Reschedule (which resets
 * `lateArrivalNotifiedAt` to `null` and replaces the delayed job) would make
 * an in-flight stale Late-Arrival worker re-eligible under CAS alone and
 * incorrectly mark the signal against the new window. A `false` CAS result
 * (or a failed pre-check) is a safe no-op - publishes nothing. Never frees
 * the table or changes `status`; that remains a staff decision (Cancel/NoShow).
 */
@Injectable()
export class ProcessLateArrivalUseCase {
  constructor(
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    private readonly tenantContext: TenantContextService,
  ) {}

  async execute(input: LateArrivalJobData): Promise<void> {
    await this.tenantContext.runAsync(
      {
        organizationId: input.organizationId,
        userId: null,
        correlationId: input.correlationId ?? input.reservationId,
      },
      () => this.markLate(input),
    );
  }

  private async markLate(input: LateArrivalJobData): Promise<void> {
    const reservationId = ReservationId.create(input.reservationId);
    const reservation = await this.reservationRepository.findById(reservationId);
    if (reservation === null || reservation.status !== ReservationStatus.Approved) {
      return;
    }
    if (reservation.reservationStartTime.toISOString() !== input.reservationStartTime) {
      return;
    }

    const now = this.clock.now();
    const applied = await this.reservationRepository.markLateArrivalNotifiedIfEligible(
      reservationId,
      now,
    );
    if (!applied) {
      return;
    }

    await this.eventPublisher.publish(
      new GuestLateArrivalNotifiedEvent(
        this.idGenerator.generate(),
        {
          reservationId: reservationId.value,
          restaurantId: input.restaurantId,
          branchId: input.branchId,
          reservationStartTime: input.reservationStartTime,
          lateArrivalNotifiedAt: now.toISOString(),
        },
        now,
        input.correlationId,
      ),
    );
  }
}
