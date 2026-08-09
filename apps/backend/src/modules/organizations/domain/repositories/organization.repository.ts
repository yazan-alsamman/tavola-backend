import { Organization } from '../entities/organization.entity';
import { OrganizationMember } from '../entities/organization-member.entity';
import { OrganizationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { OrganizationSlug } from '@shared/domain/value-objects/organization-slug.vo';
import { OrganizationMemberRole } from '../enums/organization.enums';

export interface OrganizationRepository {
  findById(id: OrganizationId): Promise<Organization | null>;
  findBySlug(slug: OrganizationSlug): Promise<Organization | null>;
  save(organization: Organization): Promise<void>;
}

export interface OrganizationMemberRepository {
  findByOrganizationAndUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<OrganizationMember | null>;
  countActiveOwners(organizationId: OrganizationId): Promise<number>;
  /** Phase 19.1 (ADR-034 §6) - resolves the current Active Owner for Emergency Ownership Transfer. */
  findOwner(organizationId: OrganizationId): Promise<OrganizationMember | null>;
  save(member: OrganizationMember): Promise<void>;
  /**
   * M2 remediation - conditional `UPDATE ... WHERE id = ? AND role = expectedRole`,
   * mirrors `SubscriptionRepository.updateIfStatus`'s CAS pattern. Used to
   * guard the current Owner's demotion during Emergency Ownership Transfer:
   * returns `false` if a concurrent transfer already moved this member away
   * from `expectedRole` between the caller's read and this write.
   */
  updateRoleIfRole(
    member: OrganizationMember,
    expectedRole: OrganizationMemberRole,
  ): Promise<boolean>;
}
