import { Inject, Injectable } from '@nestjs/common';
import { OrganizationId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { OrganizationInvitationRepository } from '../../domain/repositories/organization.repository';
import { ORGANIZATION_INVITATION_REPOSITORY } from '../tokens/organizations.tokens';
import { InvitationNotFoundException } from '../../domain/exceptions/invitation-not-found.exception';
import { InvitationNotPendingException } from '../../domain/exceptions/invitation-not-pending.exception';
import { OrganizationInvitationRevokedEvent } from '../../domain/events/organization.events';
import { RevokeOrganizationInvitationCommand } from '../dto/organization-invitation.dto';
import { toOrganizationInvitationResult } from '../mappers/organization-invitation-result.mapper';
import { OrganizationInvitationResult } from '../dto/organization-invitation.dto';

/**
 * Phase 19.8 (Owner Invite, ADR-036, Section 11). Owner/Admin only. Uses a
 * CAS write (`revokeIfPending`) rather than a plain unconditional update -
 * revoking an invitation that already transitioned (accepted / already
 * revoked / lost a concurrent race) fails closed with a 409 rather than
 * silently reporting success.
 */
@Injectable()
export class RevokeOrganizationInvitationUseCase {
  constructor(
    @Inject(ORGANIZATION_INVITATION_REPOSITORY)
    private readonly invitationRepository: OrganizationInvitationRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(
    command: RevokeOrganizationInvitationCommand,
  ): Promise<OrganizationInvitationResult> {
    const organizationId = OrganizationId.create(command.organizationId);
    const invitation = await this.invitationRepository.findById(
      command.invitationId,
      organizationId,
    );
    if (invitation === null) {
      throw new InvitationNotFoundException();
    }

    const now = this.clock.now();
    const revoked = await this.invitationRepository.revokeIfPending(
      command.invitationId,
      organizationId,
      now,
    );
    if (!revoked) {
      throw new InvitationNotPendingException();
    }

    await this.eventPublisher.publish(
      new OrganizationInvitationRevokedEvent(
        this.idGenerator.generate(),
        {
          organizationId: organizationId.value,
          actorId: command.actorId,
          invitationId: invitation.id,
          email: invitation.email,
        },
        now,
        command.correlationId,
      ),
    );

    return toOrganizationInvitationResult(invitation.revoke(now), now);
  }
}
