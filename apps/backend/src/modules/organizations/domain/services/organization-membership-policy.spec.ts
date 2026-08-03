import { OrganizationMembershipPolicy } from './organization-membership-policy';
import { OrganizationMember } from '../entities/organization-member.entity';
import { OrganizationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { OrganizationMemberRole, OrganizationMemberStatus } from '../enums/organization.enums';
import { OrganizationOwnerInvariantException } from '../exceptions/organization-owner-invariant.exception';

describe('OrganizationMembershipPolicy', () => {
  const now = new Date('2026-08-02T12:00:00.000Z');
  const organizationId = OrganizationId.create('11111111-1111-4111-8111-111111111111');
  const otherOrganizationId = OrganizationId.create('99999999-9999-4999-8999-999999999999');
  const userId = UserId.create('22222222-2222-4222-8222-222222222222');

  function member(overrides: {
    id?: string;
    organizationId?: string;
    role?: OrganizationMemberRole;
    status?: OrganizationMemberStatus;
  }): OrganizationMember {
    return OrganizationMember.create({
      id: overrides.id ?? '33333333-3333-4333-8333-333333333333',
      organizationId: overrides.organizationId ?? organizationId.value,
      userId: userId.value,
      role: overrides.role ?? OrganizationMemberRole.Owner,
      status: overrides.status ?? OrganizationMemberStatus.Active,
      invitedAt: now,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  describe('createOwnerMembership', () => {
    it('creates an Active Owner membership, joined immediately (no invite step)', () => {
      const created = OrganizationMembershipPolicy.createOwnerMembership(
        { organizationId, userId, at: now },
        '44444444-4444-4444-8444-444444444444',
      );

      expect(created.role).toBe(OrganizationMemberRole.Owner);
      expect(created.status).toBe(OrganizationMemberStatus.Active);
      expect(created.isOwner()).toBe(true);
      expect(created.organizationId.value).toBe(organizationId.value);
      expect(created.userId.value).toBe(userId.value);
      expect(created.toProps().invitedAt).toBe(now);
      expect(created.toProps().joinedAt).toBe(now);
    });
  });

  describe('assertSingleActiveOwner', () => {
    it('does not throw when exactly one Active Owner exists for the organization', () => {
      const members = [
        member({ role: OrganizationMemberRole.Owner, status: OrganizationMemberStatus.Active }),
        member({ role: OrganizationMemberRole.Admin, status: OrganizationMemberStatus.Active }),
      ];
      expect(() =>
        OrganizationMembershipPolicy.assertSingleActiveOwner(members, organizationId),
      ).not.toThrow();
    });

    it('throws OrganizationOwnerInvariantException when there is no Active Owner', () => {
      const members = [
        member({ role: OrganizationMemberRole.Admin, status: OrganizationMemberStatus.Active }),
      ];
      expect(() =>
        OrganizationMembershipPolicy.assertSingleActiveOwner(members, organizationId),
      ).toThrow(OrganizationOwnerInvariantException);
    });

    it('throws OrganizationOwnerInvariantException when there is more than one Active Owner', () => {
      const members = [
        member({
          id: '55555555-5555-4555-8555-555555555555',
          role: OrganizationMemberRole.Owner,
          status: OrganizationMemberStatus.Active,
        }),
        member({
          id: '66666666-6666-4666-8666-666666666666',
          role: OrganizationMemberRole.Owner,
          status: OrganizationMemberStatus.Active,
        }),
      ];
      expect(() =>
        OrganizationMembershipPolicy.assertSingleActiveOwner(members, organizationId),
      ).toThrow(OrganizationOwnerInvariantException);
    });

    it('does not count a Removed Owner as active', () => {
      const members = [
        member({ role: OrganizationMemberRole.Owner, status: OrganizationMemberStatus.Removed }),
      ];
      expect(() =>
        OrganizationMembershipPolicy.assertSingleActiveOwner(members, organizationId),
      ).toThrow(OrganizationOwnerInvariantException);
    });

    it('scopes the count to the given organizationId, ignoring other organizations entirely', () => {
      const members = [
        member({
          organizationId: otherOrganizationId.value,
          role: OrganizationMemberRole.Owner,
          status: OrganizationMemberStatus.Active,
        }),
      ];
      expect(() =>
        OrganizationMembershipPolicy.assertSingleActiveOwner(members, organizationId),
      ).toThrow(OrganizationOwnerInvariantException);
    });
  });

  describe('canInviteMembers', () => {
    it.each([OrganizationMemberRole.Owner, OrganizationMemberRole.Admin])(
      '%s can invite members',
      (role) => {
        expect(OrganizationMembershipPolicy.canInviteMembers(role)).toBe(true);
      },
    );

    it.each([OrganizationMemberRole.Billing, OrganizationMemberRole.Staff])(
      '%s cannot invite members',
      (role) => {
        expect(OrganizationMembershipPolicy.canInviteMembers(role)).toBe(false);
      },
    );
  });
});
