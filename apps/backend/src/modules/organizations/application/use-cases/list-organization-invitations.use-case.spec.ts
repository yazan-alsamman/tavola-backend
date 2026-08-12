import { ListOrganizationInvitationsUseCase } from './list-organization-invitations.use-case';
import { OrganizationInvitation } from '../../domain/entities/organization-invitation.entity';
import {
  OrganizationMemberRole,
  OrganizationInvitationStatus,
} from '../../domain/enums/organization.enums';
import {
  FixedClock,
  InMemoryOrganizationInvitationRepository,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('ListOrganizationInvitationsUseCase', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const otherOrganizationId = '99999999-9999-4999-8999-999999999999';

  function build() {
    const invitationRepository = new InMemoryOrganizationInvitationRepository();
    const useCase = new ListOrganizationInvitationsUseCase(
      invitationRepository,
      new FixedClock(now),
    );
    return { useCase, invitationRepository };
  }

  it('lists only the caller organization’s invitations and resolves live "expired" state (Section 3/4)', async () => {
    const { useCase, invitationRepository } = build();

    await invitationRepository.save(
      OrganizationInvitation.create({
        id: 'inv-pending',
        organizationId,
        email: 'pending@example.com',
        role: OrganizationMemberRole.Staff,
        tokenHash: 'hash-1',
        invitedByUserId: 'inviter',
        status: OrganizationInvitationStatus.Pending,
        expiresAt: new Date(now.getTime() + 3_600_000),
        acceptedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await invitationRepository.save(
      OrganizationInvitation.create({
        id: 'inv-expired',
        organizationId,
        email: 'expired@example.com',
        role: OrganizationMemberRole.Staff,
        tokenHash: 'hash-2',
        invitedByUserId: 'inviter',
        status: OrganizationInvitationStatus.Pending,
        expiresAt: new Date(now.getTime() - 1),
        acceptedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await invitationRepository.save(
      OrganizationInvitation.create({
        id: 'inv-other-org',
        organizationId: otherOrganizationId,
        email: 'other@example.com',
        role: OrganizationMemberRole.Staff,
        tokenHash: 'hash-3',
        invitedByUserId: 'inviter',
        status: OrganizationInvitationStatus.Pending,
        expiresAt: new Date(now.getTime() + 3_600_000),
        acceptedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const result = await useCase.execute({ organizationId, page: 1, limit: 20 });

    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.id).sort()).toEqual(['inv-expired', 'inv-pending']);
    expect(result.items.find((item) => item.id === 'inv-expired')?.status).toBe('expired');
    expect(result.items.find((item) => item.id === 'inv-pending')?.status).toBe('pending');
  });
});
