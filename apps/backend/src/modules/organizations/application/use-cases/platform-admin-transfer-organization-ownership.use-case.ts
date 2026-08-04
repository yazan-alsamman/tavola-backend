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
import { OrganizationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { OrganizationMemberRepository } from '../../domain/repositories/organization.repository';
import { ORGANIZATION_MEMBER_REPOSITORY } from '../tokens/organizations.tokens';
import { OrganizationMemberNotFoundException } from '../../domain/exceptions/organization-member-not-found.exception';
import { OrganizationMembershipPolicy } from '../../domain/services/organization-membership-policy';
import { OrganizationOwnershipTransferredEvent } from '../../domain/events/organization.events';
import {
  OwnershipTransferResult,
  TransferOrganizationOwnershipCommand,
} from '../dto/platform-admin-organization.dto';

/**
 * ADR-034 §6 - the narrow, PlatformAdmin-only emergency ownership transfer
 * that finally resolves `OwnershipTransferRequiredException`'s previously
 * unsatisfiable precondition (no transfer path existed anywhere in the
 * codebase before this). Reuses `OrganizationMembershipPolicy.assertSingleActiveOwner`'s
 * invariant unchanged, via the new `transferOwnership` policy method - see
 * that method's own doc comment for why this deliberately does not go
 * through `OrganizationMember.changeRole()`.
 */
@Injectable()
export class PlatformAdminTransferOrganizationOwnershipUseCase {
  constructor(
    @Inject(ORGANIZATION_MEMBER_REPOSITORY)
    private readonly organizationMemberRepository: OrganizationMemberRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: TransferOrganizationOwnershipCommand): Promise<OwnershipTransferResult> {
    return this.tenantContext.runAsync(
      {
        organizationId: command.organizationId,
        userId: null,
        correlationId: command.correlationId ?? command.organizationId,
        actorType: 'PlatformAdmin',
      },
      async () => {
        const organizationId = OrganizationId.create(command.organizationId);
        const currentOwner = await this.organizationMemberRepository.findOwner(organizationId);
        if (currentOwner === null) {
          throw new OrganizationMemberNotFoundException();
        }
        const targetMember = await this.organizationMemberRepository.findByOrganizationAndUser(
          organizationId,
          UserId.create(command.newOwnerUserId),
        );
        if (targetMember === null) {
          throw new OrganizationMemberNotFoundException();
        }

        const now = this.clock.now();
        const { previousOwner, newOwner } = OrganizationMembershipPolicy.transferOwnership(
          currentOwner,
          targetMember,
          now,
        );

        await this.unitOfWork.execute(async () => {
          await this.organizationMemberRepository.save(previousOwner);
          await this.organizationMemberRepository.save(newOwner);
        });

        await this.eventPublisher.publish(
          new OrganizationOwnershipTransferredEvent(
            this.idGenerator.generate(),
            {
              organizationId: command.organizationId,
              actorId: command.actorId,
              previousOwnerUserId: previousOwner.userId.value,
              newOwnerUserId: newOwner.userId.value,
            },
            now,
            command.correlationId,
          ),
        );

        return {
          organizationId: command.organizationId,
          previousOwnerUserId: previousOwner.userId.value,
          newOwnerUserId: newOwner.userId.value,
        };
      },
    );
  }
}
