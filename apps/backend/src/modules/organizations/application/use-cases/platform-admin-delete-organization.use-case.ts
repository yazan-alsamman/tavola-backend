import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import {
  TenantContextPort,
  TENANT_CONTEXT_PORT,
} from '@shared/application/ports/tenant-context.port';
import { OrganizationId } from '@shared/domain/value-objects/identifiers.vo';
import { OrganizationRepository } from '../../domain/repositories/organization.repository';
import { ORGANIZATION_REPOSITORY } from '../tokens/organizations.tokens';
import { OrganizationNotFoundException } from '../../domain/exceptions/organization-not-found.exception';
import { OrganizationDeletedEvent } from '../../domain/events/organization.events';
import {
  PlatformAdminOrganizationLifecycleCommand,
  PlatformAdminOrganizationResult,
} from '../dto/platform-admin-organization.dto';
import { toPlatformAdminOrganizationResult } from '../mappers/platform-admin-organization.mapper';

/**
 * ADR-034 §4. `:id` already IS the organizationId, so this is pure ADR-035
 * Pattern 1 (identical shape to `PlatformAdminSuspendOrganizationUseCase`).
 * Mirrors `PlatformAdminDeleteRestaurantUseCase` exactly: soft delete only
 * (`Organization.softDelete()`), no precondition on current `deletedAt`
 * state (works whether Active or Suspended, and re-applies harmlessly if
 * already deleted - matches Restaurant Delete's own precedent, deliberately
 * NOT the Suspend/Reactivate reference-equality idempotency pattern, since
 * `softDelete()` itself never returns the same instance). Never mutates
 * Restaurant/Branch/Employee/Reservation data - no cascade, ever (§5,
 * extended by the same reasoning already applied to Suspend). No
 * `SubscriptionUsage` counter to decrement here (unlike Restaurant Delete) -
 * Organization is the top of the tenant tree, not counted within a larger
 * aggregate.
 */
@Injectable()
export class PlatformAdminDeleteOrganizationUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(
    command: PlatformAdminOrganizationLifecycleCommand,
  ): Promise<PlatformAdminOrganizationResult> {
    return this.tenantContext.runAsync(
      {
        organizationId: command.organizationId,
        userId: null,
        correlationId: command.correlationId ?? command.organizationId,
        actorType: 'PlatformAdmin',
      },
      async () => {
        const organization = await this.organizationRepository.findById(
          OrganizationId.create(command.organizationId),
        );
        if (organization === null) {
          throw new OrganizationNotFoundException();
        }

        const now = this.clock.now();
        const deleted = organization.softDelete(now);
        await this.organizationRepository.save(deleted);

        await this.eventPublisher.publish(
          new OrganizationDeletedEvent(
            this.idGenerator.generate(),
            { organizationId: command.organizationId, actorId: command.actorId },
            now,
            command.correlationId,
          ),
        );

        return toPlatformAdminOrganizationResult(deleted);
      },
    );
  }
}
