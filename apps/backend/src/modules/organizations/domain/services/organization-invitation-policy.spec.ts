import { OrganizationInvitationPolicy } from './organization-invitation-policy';
import { OrganizationInvitation } from '../entities/organization-invitation.entity';
import { OrganizationMemberRole, OrganizationInvitationStatus } from '../enums/organization.enums';
import { InvitationCannotGrantOwnerRoleException } from '../exceptions/invitation-cannot-grant-owner-role.exception';

describe('OrganizationInvitationPolicy', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');

  function buildInvitation(
    overrides: Partial<Parameters<typeof OrganizationInvitation.create>[0]> = {},
  ) {
    return OrganizationInvitation.create({
      id: 'invitation-1',
      organizationId: 'org-1',
      email: 'invitee@example.com',
      role: OrganizationMemberRole.Admin,
      tokenHash: 'hash',
      invitedByUserId: 'inviter-1',
      status: OrganizationInvitationStatus.Pending,
      expiresAt: new Date(now.getTime() + 3_600_000),
      acceptedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  }

  describe('assertRoleIsInvitable', () => {
    it('rejects Owner', () => {
      expect(() =>
        OrganizationInvitationPolicy.assertRoleIsInvitable(OrganizationMemberRole.Owner),
      ).toThrow(InvitationCannotGrantOwnerRoleException);
    });

    it.each([
      OrganizationMemberRole.Admin,
      OrganizationMemberRole.Billing,
      OrganizationMemberRole.Staff,
    ])('allows %s', (role) => {
      expect(() => OrganizationInvitationPolicy.assertRoleIsInvitable(role)).not.toThrow();
    });
  });

  describe('resolveState', () => {
    it('returns "pending" for a live, un-expired Pending invitation', () => {
      const invitation = buildInvitation();
      expect(OrganizationInvitationPolicy.resolveState(invitation, now)).toBe('pending');
    });

    it('returns "expired" for a still-Pending row whose expiresAt has passed - never persisted, always derived', () => {
      const invitation = buildInvitation({ expiresAt: new Date(now.getTime() - 1) });
      expect(OrganizationInvitationPolicy.resolveState(invitation, now)).toBe('expired');
    });

    it('returns "accepted" once consumed, even if expiresAt is still in the future', () => {
      const invitation = buildInvitation({
        status: OrganizationInvitationStatus.Accepted,
        acceptedAt: now,
      });
      expect(OrganizationInvitationPolicy.resolveState(invitation, now)).toBe('accepted');
    });

    it('returns "revoked" once revoked, even if expiresAt is still in the future', () => {
      const invitation = buildInvitation({ status: OrganizationInvitationStatus.Revoked });
      expect(OrganizationInvitationPolicy.resolveState(invitation, now)).toBe('revoked');
    });
  });
});
