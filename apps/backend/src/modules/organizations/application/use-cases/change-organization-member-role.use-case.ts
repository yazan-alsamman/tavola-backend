import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { OrganizationMemberRepository } from '../../domain/repositories/organization.repository';
import { ORGANIZATION_MEMBER_REPOSITORY } from '../tokens/organizations.tokens';
import { OrganizationMemberRole } from '../../domain/enums/organization.enums';
import { OrganizationMemberNotFoundException } from '../../domain/exceptions/organization-member-not-found.exception';
import { OwnershipTransferRequiredException } from '../../domain/exceptions/ownership-transfer-required.exception';
import { OrganizationMemberRoleChangedEvent } from '../../domain/events/organization.events';
import {
  ChangeOrganizationMemberRoleCommand,
  OrganizationMemberResult,
} from '../dto/organization-member.dto';
import { toOrganizationMemberResult } from '../mappers/organization-member-result.mapper';

/**
 * Phase 19.7 - Organization self-service member management (ADR-034 §7,
 * previously deferred, explicitly authorized this session). Owner/Admin
 * only, gated by `OrganizationMemberGuard` + `@RequireOrgRole(Owner, Admin)`
 * at the controller - the same guard/decorator pair Employee role-assignment
 * already uses.
 *
 * `findById` on `OrganizationMemberRepository` is itself tenant-scoped
 * (`OrganizationMember` is a `DIRECT_TENANT_OWNED_MODEL` - the Prisma
 * extension force-injects the bound `organizationId`), so a `targetMemberId`
 * belonging to another Organization structurally cannot be found here - no
 * separate cross-org IDOR check is needed, it fails closed by construction.
 *
 * Promoting a member TO Owner via this route is explicitly rejected -
 * `OrganizationMember.changeRole()` only guards the *demotion* direction
 * (throws if the target already IS Owner); this use case adds the symmetric
 * guard for the *promotion* direction, reusing the same
 * `OwnershipTransferRequiredException` for both, since both are the same
 * underlying rule: any role change touching Owner must go through the
 * dedicated Transfer operation, never the generic role-change path (this
 * is what makes ADR-034 §6's `assertSingleActiveOwner` invariant
 * unbreakable via this endpoint).
 */
@Injectable()
export class ChangeOrganizationMemberRoleUseCase {
  constructor(
    @Inject(ORGANIZATION_MEMBER_REPOSITORY)
    private readonly organizationMemberRepository: OrganizationMemberRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: ChangeOrganizationMemberRoleCommand): Promise<OrganizationMemberResult> {
    const target = await this.organizationMemberRepository.findById(command.targetMemberId);
    if (target === null) {
      throw new OrganizationMemberNotFoundException();
    }

    if (command.newRole === OrganizationMemberRole.Owner && !target.isOwner()) {
      throw new OwnershipTransferRequiredException();
    }

    const now = this.clock.now();
    const previousRole = target.role;
    const updated = target.changeRole(command.newRole, now);
    await this.organizationMemberRepository.save(updated);

    await this.eventPublisher.publish(
      new OrganizationMemberRoleChangedEvent(
        this.idGenerator.generate(),
        {
          organizationId: command.organizationId,
          actorId: command.actorId,
          memberId: updated.id,
          targetUserId: updated.userId.value,
          previousRole,
          newRole: command.newRole,
        },
        now,
        command.correlationId,
      ),
    );

    return toOrganizationMemberResult(updated);
  }
}
