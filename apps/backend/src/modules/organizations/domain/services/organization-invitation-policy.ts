import { OrganizationInvitation } from '../entities/organization-invitation.entity';
import { OrganizationMemberRole, OrganizationInvitationStatus } from '../enums/organization.enums';
import { InvitationCannotGrantOwnerRoleException } from '../exceptions/invitation-cannot-grant-owner-role.exception';

/**
 * Resolved invitation state at a point in time. `'expired'` is never
 * persisted (see `OrganizationInvitationStatus`'s own comment) - it is
 * derived here from `expiresAt`, exactly mirroring
 * `PasswordResetPolicy.resolveTokenState`'s existing precedent for a
 * TTL-bound, un-swept token record.
 */
export type OrganizationInvitationState = 'pending' | 'expired' | 'accepted' | 'revoked';

export class OrganizationInvitationPolicy {
  /**
   * Section 13 - an invitation must never directly grant the Owner role.
   * Owner changes remain exclusively `OrganizationMembershipPolicy.transferOwnership`.
   */
  static assertRoleIsInvitable(role: OrganizationMemberRole): void {
    if (role === OrganizationMemberRole.Owner) {
      throw new InvitationCannotGrantOwnerRoleException();
    }
  }

  static resolveState(invitation: OrganizationInvitation, now: Date): OrganizationInvitationState {
    if (invitation.status === OrganizationInvitationStatus.Accepted) {
      return 'accepted';
    }
    if (invitation.status === OrganizationInvitationStatus.Revoked) {
      return 'revoked';
    }
    if (invitation.isExpired(now)) {
      return 'expired';
    }
    return 'pending';
  }
}
