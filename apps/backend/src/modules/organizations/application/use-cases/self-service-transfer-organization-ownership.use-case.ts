import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { OrganizationId } from '@shared/domain/value-objects/identifiers.vo';
import { OrganizationMemberRepository } from '../../domain/repositories/organization.repository';
import { ORGANIZATION_MEMBER_REPOSITORY } from '../tokens/organizations.tokens';
import { OrganizationMemberRole } from '../../domain/enums/organization.enums';
import { OrganizationMemberNotFoundException } from '../../domain/exceptions/organization-member-not-found.exception';
import { OwnershipTransferConflictException } from '../../domain/exceptions/ownership-transfer-conflict.exception';
import { OrganizationMembershipPolicy } from '../../domain/services/organization-membership-policy';
import { OrganizationOwnershipTransferredEvent } from '../../domain/events/organization.events';
import { OwnershipTransferResult } from '../dto/platform-admin-organization.dto';
import { SelfServiceTransferOwnershipCommand } from '../dto/organization-member.dto';

/**
 * Phase 19.7 - the self-service counterpart to
 * `PlatformAdminTransferOrganizationOwnershipUseCase` (ADR-034 §6, Phase
 * 19.1). Reuses `OrganizationMembershipPolicy.transferOwnership` and the
 * CAS-guarded (`updateRoleIfRole`) persistence pattern verbatim - the only
 * two differences from the PlatformAdmin version are structural, not
 * business-logic:
 *
 * 1. **Entry point.** No manual `TenantContextPort.runAsync` rebind - this
 *    route runs under the ordinary `JwtAuthGuard`/`OrganizationMemberGuard`
 *    flow, so `TenantContextInterceptor` has already bound `organizationId`
 *    from the caller's own JWT before this use case runs (TENANCY.md).
 * 2. **Actor-is-current-owner check.** The PlatformAdmin version trusts the
 *    guard-verified PlatformAdmin unconditionally (it targets any
 *    Organization by design). Self-service Transfer additionally verifies
 *    `currentOwner.userId === command.actorId` - although `@RequireOrgRole(Owner)`
 *    already implies the caller held the Owner role *at token-issuance
 *    time*, `permissionsVersion`/`orgRole` staleness (same documented
 *    window Employee role changes tolerate until refresh) means the actor's
 *    embedded claim could theoretically be stale if ownership already
 *    changed since their last token refresh - this re-check makes that
 *    window's failure mode an explicit 409, never a silent wrong-actor
 *    transfer.
 */
@Injectable()
export class SelfServiceTransferOrganizationOwnershipUseCase {
  constructor(
    @Inject(ORGANIZATION_MEMBER_REPOSITORY)
    private readonly organizationMemberRepository: OrganizationMemberRepository,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: SelfServiceTransferOwnershipCommand): Promise<OwnershipTransferResult> {
    const organizationId = OrganizationId.create(command.organizationId);
    const currentOwner = await this.organizationMemberRepository.findOwner(organizationId);
    if (currentOwner === null) {
      throw new OrganizationMemberNotFoundException();
    }
    if (currentOwner.userId.value !== command.actorId) {
      throw new OwnershipTransferConflictException(
        'Caller is no longer the current Organization Owner - refresh your session and retry.',
      );
    }

    const targetMember = await this.organizationMemberRepository.findById(command.targetMemberId);
    if (targetMember === null) {
      throw new OrganizationMemberNotFoundException();
    }

    const now = this.clock.now();
    const { previousOwner, newOwner } = OrganizationMembershipPolicy.transferOwnership(
      currentOwner,
      targetMember,
      now,
    );

    let applied = false;
    await this.unitOfWork.execute(async () => {
      applied = await this.organizationMemberRepository.updateRoleIfRole(
        previousOwner,
        OrganizationMemberRole.Owner,
      );
      if (applied) {
        await this.organizationMemberRepository.save(newOwner);
      }
    });
    if (!applied) {
      throw new OwnershipTransferConflictException(
        'Organization ownership changed concurrently - retry.',
      );
    }

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
  }
}
