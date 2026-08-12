import { Organization } from '../entities/organization.entity';
import { OrganizationMember } from '../entities/organization-member.entity';
import { OrganizationInvitation } from '../entities/organization-invitation.entity';
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

  /**
   * Phase 19.7 (Organization self-service member management) - resolves a
   * member by its own id, scoped by `OrganizationMember` being a
   * `DIRECT_TENANT_OWNED_MODEL` (`tenant-scoped-prisma.extension.ts`): the
   * Prisma extension force-injects the bound `organizationId` into the
   * query's `where` clause, so a memberId belonging to a different
   * Organization structurally cannot be found this way - the caller never
   * needs a separate cross-org existence check, it fails closed by
   * construction (TENANCY.md's fail-closed guarantee).
   */
  findById(id: string): Promise<OrganizationMember | null>;

  /** Phase 19.7 - lists every member of the bound (tenant-scoped) Organization, newest first. */
  listByOrganization(
    page: number,
    limit: number,
  ): Promise<{ items: OrganizationMember[]; total: number }>;
}

/**
 * Phase 19.8 (Owner Invite, ADR-036). Deliberately NOT scoped by the
 * automatic `withTenantScoping` Prisma extension (`OrganizationInvitation`
 * is not in `DIRECT_TENANT_OWNED_MODELS`) - see that model's own
 * schema.prisma comment. `organizationId` is instead passed explicitly into
 * every method that must not cross tenants (application-layer enforcement,
 * the same pattern `Employee`'s repository already uses) - `findByTokenHash`
 * is the sole deliberate exception, mirroring `PasswordResetRepository.findByTokenHash`'s
 * own unscoped lookup, since the invitee has no bound `TenantContext` yet.
 */
export interface OrganizationInvitationRepository {
  save(invitation: OrganizationInvitation): Promise<void>;
  findById(id: string, organizationId: OrganizationId): Promise<OrganizationInvitation | null>;
  findByTokenHash(tokenHash: string): Promise<OrganizationInvitation | null>;
  findActivePendingByOrganizationAndEmail(
    organizationId: OrganizationId,
    email: string,
  ): Promise<OrganizationInvitation | null>;
  listByOrganization(
    organizationId: OrganizationId,
    page: number,
    limit: number,
  ): Promise<{ items: OrganizationInvitation[]; total: number }>;
  /** Resend semantics (Section 11): bulk-revokes any still-Pending invitation for this org+email before a new one is issued. */
  revokePendingByOrganizationAndEmail(
    organizationId: OrganizationId,
    email: string,
    at: Date,
  ): Promise<void>;
  /** CAS: `UPDATE ... WHERE id = ? AND organizationId = ? AND status = 'Pending'`. Returns whether it actually revoked a row. */
  revokeIfPending(id: string, organizationId: OrganizationId, at: Date): Promise<boolean>;
  /** CAS: `UPDATE ... WHERE id = ? AND status = 'Pending'`. Returns whether it actually consumed the row (loses the race on concurrent accept/revoke). */
  consumeIfPending(id: string, at: Date): Promise<boolean>;
}
