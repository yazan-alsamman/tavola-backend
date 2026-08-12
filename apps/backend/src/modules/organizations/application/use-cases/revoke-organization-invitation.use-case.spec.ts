import { RevokeOrganizationInvitationUseCase } from './revoke-organization-invitation.use-case';
import { OrganizationInvitation } from '../../domain/entities/organization-invitation.entity';
import { InvitationNotFoundException } from '../../domain/exceptions/invitation-not-found.exception';
import { InvitationNotPendingException } from '../../domain/exceptions/invitation-not-pending.exception';
import { OrganizationInvitationRevokedEvent } from '../../domain/events/organization.events';
import {
  OrganizationMemberRole,
  OrganizationInvitationStatus,
} from '../../domain/enums/organization.enums';
import {
  CollectingEventPublisher,
  FixedClock,
  InMemoryOrganizationInvitationRepository,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('RevokeOrganizationInvitationUseCase', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const otherOrganizationId = '99999999-9999-4999-8999-999999999999';
  const actorId = '22222222-2222-4222-8222-222222222222';

  function build() {
    const invitationRepository = new InMemoryOrganizationInvitationRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new RevokeOrganizationInvitationUseCase(
      invitationRepository,
      new FixedClock(now),
      new SequentialIdGenerator(['33333333-3333-4333-8333-333333333333']),
      eventPublisher,
    );
    return { useCase, invitationRepository, eventPublisher };
  }

  function pendingInvitation(
    overrides: Partial<Parameters<typeof OrganizationInvitation.create>[0]> = {},
  ) {
    return OrganizationInvitation.create({
      id: 'invitation-1',
      organizationId,
      email: 'invitee@example.com',
      role: OrganizationMemberRole.Staff,
      tokenHash: 'hash',
      invitedByUserId: 'inviter',
      status: OrganizationInvitationStatus.Pending,
      expiresAt: new Date(now.getTime() + 3_600_000),
      acceptedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  }

  it('revokes a Pending invitation immediately, even though it has not expired, and publishes the event', async () => {
    const { useCase, invitationRepository, eventPublisher } = build();
    await invitationRepository.save(pendingInvitation());

    const result = await useCase.execute({ organizationId, actorId, invitationId: 'invitation-1' });

    expect(result.status).toBe('revoked');
    const event = eventPublisher.events[0] as OrganizationInvitationRevokedEvent;
    expect(event).toBeInstanceOf(OrganizationInvitationRevokedEvent);
    expect(event.payload).toMatchObject({ organizationId, actorId, invitationId: 'invitation-1' });
  });

  it('404s for an invitation belonging to a different Organization (cross-tenant)', async () => {
    const { useCase, invitationRepository } = build();
    await invitationRepository.save(pendingInvitation({ organizationId: otherOrganizationId }));

    await expect(
      useCase.execute({ organizationId, actorId, invitationId: 'invitation-1' }),
    ).rejects.toBeInstanceOf(InvitationNotFoundException);
  });

  it('404s for an unknown invitationId', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute({ organizationId, actorId, invitationId: 'does-not-exist' }),
    ).rejects.toBeInstanceOf(InvitationNotFoundException);
  });

  it('409s revoking an already-Accepted invitation', async () => {
    const { useCase, invitationRepository } = build();
    await invitationRepository.save(
      pendingInvitation({ status: OrganizationInvitationStatus.Accepted, acceptedAt: now }),
    );

    await expect(
      useCase.execute({ organizationId, actorId, invitationId: 'invitation-1' }),
    ).rejects.toBeInstanceOf(InvitationNotPendingException);
  });

  it('409s revoking an already-Revoked invitation (idempotency is not silent success)', async () => {
    const { useCase, invitationRepository } = build();
    await invitationRepository.save(
      pendingInvitation({ status: OrganizationInvitationStatus.Revoked }),
    );

    await expect(
      useCase.execute({ organizationId, actorId, invitationId: 'invitation-1' }),
    ).rejects.toBeInstanceOf(InvitationNotPendingException);
  });
});
