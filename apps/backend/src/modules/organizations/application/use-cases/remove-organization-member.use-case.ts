import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { OrganizationId } from '@shared/domain/value-objects/identifiers.vo';
import { OrganizationMemberRepository } from '../../domain/repositories/organization.repository';
import { ORGANIZATION_MEMBER_REPOSITORY } from '../tokens/organizations.tokens';
import { OrganizationMemberNotFoundException } from '../../domain/exceptions/organization-member-not-found.exception';
import { OrganizationMemberRemovedEvent } from '../../domain/events/organization.events';
import {
  OrganizationMemberResult,
  RemoveOrganizationMemberCommand,
} from '../dto/organization-member.dto';
import { toOrganizationMemberResult } from '../mappers/organization-member-result.mapper';

/**
 * Phase 19.7 - Organization self-service member management (ADR-034 §7).
 * Owner/Admin only. `findById` is tenant-scoped (`DIRECT_TENANT_OWNED_MODEL`),
 * so a cross-org `targetMemberId` fails closed by construction - see
 * `ChangeOrganizationMemberRoleUseCase`'s own doc comment for the identical
 * reasoning.
 *
 * Soft status-flip only (`OrganizationMember.remove()` sets
 * `status: Removed`) - `OrganizationMember` has no `deletedAt` column at all
 * (unlike Employee's `deletedAt`), so this status transition IS the removal
 * mechanism, not a secondary marker alongside one.
 *
 * `assertCanBeRemoved` (existing entity method, reused verbatim) throws
 * `SoleOwnerRemovalException` if the target is the sole Active Owner -
 * removing the Owner requires transferring ownership first (Transfer use
 * case), exactly mirroring the Change-Role use case's Owner-touching guard.
 */
@Injectable()
export class RemoveOrganizationMemberUseCase {
  constructor(
    @Inject(ORGANIZATION_MEMBER_REPOSITORY)
    private readonly organizationMemberRepository: OrganizationMemberRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: RemoveOrganizationMemberCommand): Promise<OrganizationMemberResult> {
    const target = await this.organizationMemberRepository.findById(command.targetMemberId);
    if (target === null) {
      throw new OrganizationMemberNotFoundException();
    }

    const activeOwnerCount = await this.organizationMemberRepository.countActiveOwners(
      OrganizationId.create(command.organizationId),
    );
    target.assertCanBeRemoved(activeOwnerCount);

    const now = this.clock.now();
    const removed = target.remove(now);
    await this.organizationMemberRepository.save(removed);

    await this.eventPublisher.publish(
      new OrganizationMemberRemovedEvent(
        this.idGenerator.generate(),
        {
          organizationId: command.organizationId,
          actorId: command.actorId,
          memberId: removed.id,
          targetUserId: removed.userId.value,
        },
        now,
        command.correlationId,
      ),
    );

    return toOrganizationMemberResult(removed);
  }
}
