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
import { SubscriptionSuspendedEvent } from '../../domain/events/subscription.events';
import { toSubscriptionResult } from '../mappers/subscription-result.mapper';
import { SuspendSubscriptionCommand } from '../dto/suspend-subscription.command';
import { SubscriptionResult } from '../dto/subscription.result';

/**
 * PlatformAdmin-only (D9). `Active -> Suspended` only (D8's frozen state
 * machine). Audit entry is derived automatically by `AuditingEventPublisher`
 * from `SubscriptionSuspendedEvent.payload.actorId` (D28) - no direct
 * `auditLogWriter` call here, matching every other use case in this
 * codebase's single event-driven audit mechanism.
 */
@Injectable()
export class SuspendSubscriptionUseCase {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepository: SubscriptionRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(command: SuspendSubscriptionCommand): Promise<SubscriptionResult> {
    return this.tenantContext.runAsync(
      {
        organizationId: command.organizationId,
        userId: null,
        correlationId: command.correlationId ?? command.organizationId,
      },
      () => this.suspend(command),
    );
  }

  private async suspend(command: SuspendSubscriptionCommand): Promise<SubscriptionResult> {
    const existing = await this.subscriptionRepository.findByOrganizationId();
    if (existing === null) {
      throw new SubscriptionNotFoundException();
    }

    const now = this.clock.now();
    const suspended = existing.suspend(now);

    let applied = false;
    await this.unitOfWork.execute(async () => {
      applied = await this.subscriptionRepository.updateIfStatus(suspended, existing.status);
    });
    if (!applied) {
      throw new InvalidSubscriptionStatusTransitionException(
        'Subscription state changed concurrently - retry.',
      );
    }

    await this.eventPublisher.publish(
      new SubscriptionSuspendedEvent(
        this.idGenerator.generate(),
        {
          subscriptionId: suspended.subscriptionId.value,
          organizationId: command.organizationId,
          actorId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    return toSubscriptionResult(suspended);
  }
}
