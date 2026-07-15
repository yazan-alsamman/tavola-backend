import { OrganizationMember } from '../entities/organization-member.entity';
import { OrganizationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { OrganizationMemberRole, OrganizationMemberStatus } from '../enums/organization.enums';
import { OrganizationOwnerInvariantException } from '../exceptions/organization-owner-invariant.exception';

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
}
