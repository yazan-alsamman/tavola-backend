import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { WaitlistEntryNotFoundException } from '../../domain/exceptions/waitlist-entry-not-found.exception';
import { InvalidWaitlistStatusTransitionException } from '../../domain/exceptions/invalid-waitlist-status-transition.exception';
import { WaitlistEntryCancelledEvent } from '../../domain/events/waitlist.events';
import {
  ReservationWaitlistEntryRepository,
  RESERVATION_WAITLIST_ENTRY_REPOSITORY,
} from '../../domain/repositories/reservation-waitlist-entry.repository';
import {
  assertActorCanModifyWaitlistEntry,
  resolveWaitlistActingActorType,
  resolveWaitlistActingId,
} from '../services/assert-actor-can-modify-waitlist-entry';
import {
  WaitlistExpirationSchedulerPort,
  WAITLIST_EXPIRATION_SCHEDULER,
} from '../ports/waitlist-expiration-scheduler.port';
import { toWaitlistEntryResult } from '../mappers/waitlist-entry-result.mapper';
import { CancelWaitlistEntryCommand } from '../dto/cancel-waitlist-entry.command';
import { WaitlistEntryResult } from '../dto/waitlist-entry.result';

/**
 * Phase 7.5 architecture freeze item 7/8 (`POST /waitlist/:id/cancel`) -
 * reachable from `Waiting` or `Notified`, by either the entry's own
 * Customer or a branch-scoped Employee holding `reservations:waitlist`
 * (`assertActorCanModifyWaitlistEntry`) - one route, no `PermissionsGuard`,
 * mirroring `CancelReservationUseCase` exactly.
 */
@Injectable()
export class CancelWaitlistEntryUseCase {
  constructor(
    @Inject(RESERVATION_WAITLIST_ENTRY_REPOSITORY)
    private readonly waitlistRepository: ReservationWaitlistEntryRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(WAITLIST_EXPIRATION_SCHEDULER)
    private readonly expirationScheduler: WaitlistExpirationSchedulerPort,
  ) {}

  async execute(command: CancelWaitlistEntryCommand): Promise<WaitlistEntryResult> {
    const existing = await this.waitlistRepository.findById(command.entryId);
    if (existing === null) {
      throw new WaitlistEntryNotFoundException();
    }
    assertActorCanModifyWaitlistEntry(command.actor, existing, 'reservations:waitlist');

    const now = this.clock.now();
    const sourceStatus = existing.status;
    const cancelled = existing.cancel(now);

    let applied = false;
    await this.unitOfWork.execute(async () => {
      applied = await this.waitlistRepository.updateTransitioningFrom(cancelled, sourceStatus);
    });
    if (!applied) {
      throw new InvalidWaitlistStatusTransitionException(
        `Cannot cancel waitlist entry "${command.entryId}" - it is no longer ${sourceStatus}.`,
      );
    }

    await this.expirationScheduler.cancelExpiration(existing.entryId);

    await this.eventPublisher.publish(
      new WaitlistEntryCancelledEvent(
        this.idGenerator.generate(),
        {
          entryId: existing.entryId,
          restaurantId: existing.restaurantId.value,
          branchId: existing.branchId.value,
          cancelledBy: resolveWaitlistActingId(command.actor),
          cancelledByActorType: resolveWaitlistActingActorType(command.actor),
        },
        now,
        command.correlationId,
      ),
    );

    return toWaitlistEntryResult(cancelled);
  }
}
