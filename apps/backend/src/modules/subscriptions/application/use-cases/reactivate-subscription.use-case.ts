import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import {
  TenantContextPort,
  TENANT_CONTEXT_PORT,
} from '@shared/application/ports/tenant-context.port';
import {
  SubscriptionRepository,
  SUBSCRIPTION_REPOSITORY,
} from '../../domain/repositories/subscription.repository';
import { SubscriptionNotFoundException } from '../../domain/exceptions/subscription-not-found.exception';
import { InvalidSubscriptionStatusTransitionException } from '../../domain/exceptions/invalid-subscription-status-transition.exception';
import { SubscriptionReactivatedEvent } from '../../domain/events/subscription.events';
import { toSubscriptionResult } from '../mappers/subscription-result.mapper';
import { ReactivateSubscriptionCommand } from '../dto/reactivate-subscription.command';
import { SubscriptionResult } from '../dto/subscription.result';

/**
 * PlatformAdmin-only (D9). `Suspended -> Active` only - the sole path back
 * to Active from Suspended (D8). Audit entry derived automatically by
 * `AuditingEventPublisher` (D28) - see `SuspendSubscriptionUseCase`'s own
 * doc comment.
 */
@Injectable()
export class ReactivateSubscriptionUseCase {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepository: SubscriptionRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(command: ReactivateSubscriptionCommand): Promise<SubscriptionResult> {
    return this.tenantContext.runAsync(
      {
        organizationId: command.organizationId,
        userId: null,
        correlationId: command.correlationId ?? command.organizationId,
      },
      () => this.reactivate(command),
    );
  }

  private async reactivate(command: ReactivateSubscriptionCommand): Promise<SubscriptionResult> {
    const existing = await this.subscriptionRepository.findByOrganizationId();
    if (existing === null) {
      throw new SubscriptionNotFoundException();
    }

    const now = this.clock.now();
    const reactivated = existing.reactivate(now);

    let applied = false;
    await this.unitOfWork.execute(async () => {
      applied = await this.subscriptionRepository.updateIfStatus(reactivated, existing.status);
    });
    if (!applied) {
      throw new InvalidSubscriptionStatusTransitionException(
        'Subscription state changed concurrently - retry.',
      );
    }

    await this.eventPublisher.publish(
      new SubscriptionReactivatedEvent(
        this.idGenerator.generate(),
        {
          subscriptionId: reactivated.subscriptionId.value,
          organizationId: command.organizationId,
          actorId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    return toSubscriptionResult(reactivated);
  }
}
