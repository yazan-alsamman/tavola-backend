import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { ReservationId } from '@shared/domain/value-objects/identifiers.vo';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { ReservationStatus } from '../../domain/enums/reservation.enums';
import { ReservationReminderDueEvent } from '../../domain/events/reservation.events';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';
import { ReservationReminderJobData } from '../../infrastructure/bullmq/reminder-queue.constants';

/**
 * Phase 7.6 (Operational Signals, ADR-019) - the `ReminderQueue` job's sole
 * business logic, invoked exclusively by `ReservationReminderProcessor`
 * (never an HTTP controller - there is no public reminder endpoint).
 * Domain/event side only per TASKS.md's own scope note: publishes
 * `ReservationReminderDueEvent` and nothing else - no notification delivery,
 * no `WaitlistEntryNotified`-style production path. Idempotent and a safe
 * no-op when:
 *  - the reservation no longer exists or is no longer `Approved` (Cancelled/
 *    Completed/NoShow before the reminder fired), or
 *  - `reservationStartTime` no longer matches what the job was scheduled
 *    against - a stale firing from before a Reschedule's
 *    `replaceForApproved` cancel/re-add caught up.
 */
@Injectable()
export class PublishReservationReminderUseCase {
  constructor(
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    private readonly tenantContext: TenantContextService,
  ) {}

  async execute(input: ReservationReminderJobData): Promise<void> {
    await this.tenantContext.runAsync(
      {
        organizationId: input.organizationId,
        userId: null,
        correlationId: input.correlationId ?? input.reservationId,
      },
      () => this.publish(input),
    );
  }

  private async publish(input: ReservationReminderJobData): Promise<void> {
    const reservationId = ReservationId.create(input.reservationId);
    const reservation = await this.reservationRepository.findById(reservationId);
    if (reservation === null || reservation.status !== ReservationStatus.Approved) {
      return;
    }
    if (reservation.reservationStartTime.toISOString() !== input.reservationStartTime) {
      return;
    }

    const now = this.clock.now();
    await this.eventPublisher.publish(
      new ReservationReminderDueEvent(
        this.idGenerator.generate(),
        {
          reservationId: reservationId.value,
          restaurantId: reservation.restaurantId.value,
          branchId: reservation.branchId.value,
          reservationStartTime: reservation.reservationStartTime.toISOString(),
        },
        now,
        input.correlationId,
      ),
    );
  }
}
