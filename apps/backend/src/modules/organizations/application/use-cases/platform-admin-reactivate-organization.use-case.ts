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
import { OrganizationReactivatedEvent } from '../../domain/events/organization.events';
import {
  PlatformAdminOrganizationLifecycleCommand,
  PlatformAdminOrganizationResult,
} from '../dto/platform-admin-organization.dto';
import { toPlatformAdminOrganizationResult } from '../mappers/platform-admin-organization.mapper';

/** ADR-034 §4 - see `PlatformAdminSuspendOrganizationUseCase`'s doc comment. */
@Injectable()
export class PlatformAdminReactivateOrganizationUseCase {
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
        const reactivated = organization.reactivate(now);
        await this.organizationRepository.save(reactivated);

        await this.eventPublisher.publish(
          new OrganizationReactivatedEvent(
            this.idGenerator.generate(),
            { organizationId: command.organizationId, actorId: command.actorId },
            now,
            command.correlationId,
          ),
        );

        return toPlatformAdminOrganizationResult(reactivated);
      },
    );
  }
}
