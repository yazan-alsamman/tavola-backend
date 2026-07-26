import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import {
  CLOCK,
  ID_GENERATOR,
  EVENT_PUBLISHER,
  UNIT_OF_WORK,
} from '@modules/authentication/domain/tokens/authentication.tokens';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { WaitlistStatus } from '../../domain/enums/waitlist.enums';
import { WaitlistEntryExpiredEvent } from '../../domain/events/waitlist.events';
import {
  ReservationWaitlistEntryRepository,
  RESERVATION_WAITLIST_ENTRY_REPOSITORY,
} from '../../domain/repositories/reservation-waitlist-entry.repository';

export interface ExpireWaitlistEntryInput {
  entryId: string;
  organizationId: string | null;
  correlationId?: string;
}

/**
 * Phase 7.5 architecture freeze item 2 - direct structural mirror of
 * `ExpirePendingReservationUseCase` (Phase 7.3 precedent).
 * `Waiting`/`Notified -> Expired` only, invoked exclusively by
 * `ExpireWaitlistEntryProcessor`. Idempotent: a safe no-op if the entry is
 * no longer `Waiting`/`Notified` by the time the delayed job fires (already
 * `Converted`/`Cancelled`, or already expired by a retried/duplicate
 * execution of this same job). `organizationId` is always `null`
 * (`ReservationWaitlistEntry` carries none - Phase 7.5 tenancy correction),
 * matching `ExpireReservationJobData`'s own precedent for the same reason.
 */
@Injectable()
export class ExpireWaitlistEntryUseCase {
  constructor(
    @Inject(RESERVATION_WAITLIST_ENTRY_REPOSITORY)
    private readonly waitlistRepository: ReservationWaitlistEntryRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    private readonly tenantContext: TenantContextService,
  ) {}

  async execute(input: ExpireWaitlistEntryInput): Promise<void> {
    await this.tenantContext.runAsync(
      {
        organizationId: input.organizationId,
        userId: null,
        correlationId: input.correlationId ?? input.entryId,
      },
      () => this.expire(input),
    );
  }

  private async expire(input: ExpireWaitlistEntryInput): Promise<void> {
    const existing = await this.waitlistRepository.findById(input.entryId);
    if (
      existing === null ||
      (existing.status !== WaitlistStatus.Waiting && existing.status !== WaitlistStatus.Notified)
    ) {
      return;
    }

    const now = this.clock.now();
    const sourceStatus = existing.status;
    const expired = existing.expire(now);

    let applied = false;
    await this.unitOfWork.execute(async () => {
      applied = await this.waitlistRepository.updateTransitioningFrom(expired, sourceStatus);
    });

    if (!applied) {
      return;
    }

    await this.eventPublisher.publish(
      new WaitlistEntryExpiredEvent(
        this.idGenerator.generate(),
        {
          entryId: existing.entryId,
          restaurantId: existing.restaurantId.value,
          branchId: existing.branchId.value,
        },
        now,
        input.correlationId,
      ),
    );
  }
}
