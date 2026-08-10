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
import { OrganizationNotSoftDeletedException } from '../../domain/exceptions/organization-not-soft-deleted.exception';
import { OrganizationRestoredEvent } from '../../domain/events/organization.events';
import {
  PlatformAdminOrganizationLifecycleCommand,
  PlatformAdminOrganizationResult,
} from '../dto/platform-admin-organization.dto';
import { toPlatformAdminOrganizationResult } from '../mappers/platform-admin-organization.mapper';

/**
 * ADR-034 §4 - closes the same standing "no restore capability" gap ADR-034
 * §3 already closed for Restaurant. Mirrors `PlatformAdminRestoreRestaurantUseCase`
 * exactly: rejects (409, `OrganizationNotSoftDeletedException`) an
 * Organization that is not currently deleted, rather than a silent no-op -
 * Restore/Delete are meaningfully different operator intentions, worth
 * surfacing a conflict for (same reasoning as Restaurant Restore's own doc
 * comment). Uses the ordinary `findById` - unlike `RestaurantRepository`,
 * `OrganizationRepository.findById` was never scoped to exclude soft-deleted
 * rows in the first place (a pre-existing characteristic of this repository,
 * not introduced here), so no separate `findByIdIncludingDeleted` method is
 * required to see a deleted row. Only clears `deletedAt` - never touches
 * `status`, so a Suspended-and-deleted Organization restores back to
 * Suspended, not Active (a separate Reactivate call is required for that).
 */
@Injectable()
export class PlatformAdminRestoreOrganizationUseCase {
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
        if (!organization.isSoftDeleted()) {
          throw new OrganizationNotSoftDeletedException();
        }

        const now = this.clock.now();
        const restored = organization.restore(now);
        await this.organizationRepository.save(restored);

        await this.eventPublisher.publish(
          new OrganizationRestoredEvent(
            this.idGenerator.generate(),
            { organizationId: command.organizationId, actorId: command.actorId },
            now,
            command.correlationId,
          ),
        );

        return toPlatformAdminOrganizationResult(restored);
      },
    );
  }
}
