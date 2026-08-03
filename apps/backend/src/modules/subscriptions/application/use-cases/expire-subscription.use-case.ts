import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { SubscriptionId } from '@shared/domain/value-objects/identifiers.vo';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import {
  SubscriptionRepository,
  SUBSCRIPTION_REPOSITORY,
} from '../../domain/repositories/subscription.repository';
import { SubscriptionExpiredEvent } from '../../domain/events/subscription.events';

export interface ExpireSubscriptionInput {
  subscriptionId: string;
  organizationId: string;
  correlationId?: string;
}

/**
 * ADR-027 §6/§11 - `Active -> Expired` only, BullMQ-scheduled + CAS-guarded,
 * mirroring `ExpireOfferUseCase` exactly (this is the proven repository
 * precedent D11 was frozen to reuse). Invoked exclusively by
 * `ExpireSubscriptionProcessor` - no public HTTP endpoint. Idempotent: the
 * repository's own CAS (`expireIfActiveAndDue`,
 * `WHERE status = 'Active' AND ends_at <= now`) is the sole concurrency/
 * replay authority - a safe no-op if the Subscription is no longer Active
 * (already expired by a previous retried execution, or manually
 * suspended/cancelled/changed in the meantime) by the time the delayed job
 * fires.
 */
@Injectable()
export class ExpireSubscriptionUseCase {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepository: SubscriptionRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    private readonly tenantContext: TenantContextService,
  ) {}

  async execute(input: ExpireSubscriptionInput): Promise<void> {
    await this.tenantContext.runAsync(
      {
        organizationId: input.organizationId,
        userId: null,
        correlationId: input.correlationId ?? input.subscriptionId,
      },
      () => this.expire(input),
    );
  }

  private async expire(input: ExpireSubscriptionInput): Promise<void> {
    const subscriptionId = SubscriptionId.create(input.subscriptionId);
    const existing = await this.subscriptionRepository.findById(subscriptionId);
    if (existing === null) {
      return;
    }

    const now = this.clock.now();

    let applied = false;
    await this.unitOfWork.execute(async () => {
      applied = await this.subscriptionRepository.expireIfActiveAndDue(subscriptionId, now);
    });

    if (!applied) {
      return;
    }

    await this.eventPublisher.publish(
      new SubscriptionExpiredEvent(
        this.idGenerator.generate(),
        { subscriptionId: subscriptionId.value, organizationId: existing.organizationId },
        now,
        input.correlationId,
      ),
    );
  }
}
