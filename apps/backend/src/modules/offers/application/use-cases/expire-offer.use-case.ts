import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { OfferId } from '@shared/domain/value-objects/identifiers.vo';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { OfferRepository, OFFER_REPOSITORY } from '../../domain/repositories/offer.repository';
import { OfferExpiredEvent } from '../../domain/events/offer.events';

export interface ExpireOfferInput {
  offerId: string;
  organizationId: string;
  correlationId?: string;
}

/**
 * Phase 11 (Offers, architecture frozen 2026-07-28) - `Published -> Expired`
 * only. Invoked exclusively by `ExpireOfferProcessor` (the BullMQ job
 * handler), never by an HTTP controller - there is no public expiration
 * endpoint. Idempotent: the repository's own CAS (`expireIfPublished`,
 * `WHERE status = 'Published' AND deleted_at IS NULL`) is the sole
 * concurrency/replay authority - if the Offer is no longer Published by the
 * time the delayed job fires (already expired by a previous, retried
 * execution of this same job, or soft-deleted in the meantime), this is a
 * safe no-op, mirroring `ExpirePendingReservationUseCase` exactly.
 * CODING_STANDARDS.md requires establishing Tenant Context from the job
 * payload as the first line of the handler - done here via
 * `TenantContextService.runAsync`, not in the Processor, so this use case
 * remains directly unit-testable without a real BullMQ job object (the
 * `offer` write itself needs no tenant scoping - `Offer` is not a
 * `DIRECT_TENANT_OWNED_MODEL` - this is purely CODING_STANDARDS compliance,
 * same as `ExpirePendingReservationUseCase`'s own reasoning).
 */
@Injectable()
export class ExpireOfferUseCase {
  constructor(
    @Inject(OFFER_REPOSITORY) private readonly offerRepository: OfferRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    private readonly tenantContext: TenantContextService,
  ) {}

  async execute(input: ExpireOfferInput): Promise<void> {
    await this.tenantContext.runAsync(
      {
        organizationId: input.organizationId,
        userId: null,
        correlationId: input.correlationId ?? input.offerId,
      },
      () => this.expire(input),
    );
  }

  private async expire(input: ExpireOfferInput): Promise<void> {
    const offerId = OfferId.create(input.offerId);
    const existing = await this.offerRepository.findById(offerId);
    if (existing === null) {
      return;
    }

    const now = this.clock.now();

    let applied = false;
    await this.unitOfWork.execute(async () => {
      applied = await this.offerRepository.expireIfPublished(offerId, now);
    });

    if (!applied) {
      return;
    }

    await this.eventPublisher.publish(
      new OfferExpiredEvent(
        this.idGenerator.generate(),
        {
          offerId: offerId.value,
          restaurantId: existing.restaurantId.value,
        },
        now,
        input.correlationId,
      ),
    );
  }
}
