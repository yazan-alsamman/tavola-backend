import { OrganizationMember } from '../entities/organization-member.entity';
import { OrganizationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { OrganizationMemberRole, OrganizationMemberStatus } from '../enums/organization.enums';
import { OrganizationOwnerInvariantException } from '../exceptions/organization-owner-invariant.exception';
import { OwnershipTransferConflictException } from '../exceptions/ownership-transfer-conflict.exception';

export interface OwnershipTransferOutcome {
  previousOwner: OrganizationMember;
  newOwner: OrganizationMember;
}

export interface CreateOwnerMembershipInput {
  organizationId: OrganizationId;
  userId: UserId;
  at: Date;
}

export class OrganizationMembershipPolicy {
  static createOwnerMembership(
    input: CreateOwnerMembershipInput,
    memberId: string,
  ): OrganizationMember {
    return OrganizationMember.create({
      id: memberId,
      organizationId: input.organizationId.value,
      userId: input.userId.value,
      role: OrganizationMemberRole.Owner,
      status: OrganizationMemberStatus.Active,
      invitedAt: input.at,
      joinedAt: input.at,
      createdAt: input.at,
      updatedAt: input.at,
    });
  }

  static assertSingleActiveOwner(
    members: OrganizationMember[],
    organizationId: OrganizationId,
  ): void {
    const activeOwners = members.filter(
      (member) => member.organizationId.value === organizationId.value && member.isOwner(),
    );
    if (activeOwners.length !== 1) {
      throw new OrganizationOwnerInvariantException();
    }
  }

  static canInviteMembers(role: OrganizationMemberRole): boolean {
    return role === OrganizationMemberRole.Owner || role === OrganizationMemberRole.Admin;
  }

  /**
   * ADR-034 §6 - a narrow, PlatformAdmin-only emergency ownership transfer.
   * Deliberately does NOT go through `OrganizationMember.changeRole()` -
   * that method's own owner-guard (`OwnershipTransferRequiredException`) is
   * precisely the unsatisfiable precondition this capability exists to
   * resolve (no transfer path existed anywhere in the codebase before this).
   * Reuses `assertSingleActiveOwner`'s invariant unchanged: this method's
   * result always leaves exactly one Active Owner.
   */
  static transferOwnership(
    currentOwner: OrganizationMember,
    newOwner: OrganizationMember,
    at: Date,
  ): OwnershipTransferOutcome {
    if (!currentOwner.isOwner()) {
      throw new OrganizationOwnerInvariantException();
    }
    if (currentOwner.organizationId.value !== newOwner.organizationId.value) {
      throw new OwnershipTransferConflictException(
        'Current owner and target member must belong to the same Organization.',
      );
    }
    if (newOwner.userId.value === currentOwner.userId.value) {
      throw new OwnershipTransferConflictException('Target member is already the Owner.');
    }
    if (!newOwner.isActive()) {
      throw new OwnershipTransferConflictException(
        'Target member must be an Active member to receive ownership.',
      );
    }

    return {
      previousOwner: OrganizationMember.reconstitute({
        ...currentOwner.toProps(),
        role: OrganizationMemberRole.Admin,
        updatedAt: at,
      }),
      newOwner: OrganizationMember.reconstitute({
        ...newOwner.toProps(),
        role: OrganizationMemberRole.Owner,
        updatedAt: at,
      }),
    };
  }
}
