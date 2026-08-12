import { ConfigService } from '@nestjs/config';
import { IssueOrganizationInvitationUseCase } from './issue-organization-invitation.use-case';
import { InvitationTargetAlreadyMemberException } from '../../domain/exceptions/invitation-target-already-member.exception';
import { InvitationCannotGrantOwnerRoleException } from '../../domain/exceptions/invitation-cannot-grant-owner-role.exception';
import { OrganizationMemberInvitedEvent } from '../../domain/events/organization.events';
import { OrganizationMember } from '../../domain/entities/organization-member.entity';
import { User } from '@modules/authentication/domain/entities/user.entity';
import { UserStatus } from '@modules/authentication/domain/enums/authentication.enums';
import {
  OrganizationMemberRole,
  OrganizationMemberStatus,
  OrganizationInvitationStatus,
} from '../../domain/enums/organization.enums';
import {
  CollectingEventPublisher,
  FakeOpaqueTokenService,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryOrganizationInvitationRepository,
  InMemoryOrganizationMemberRepository,
  InMemorySystemConfiguration,
  InMemoryUserRepository,
  RecordingEmailProvider,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('IssueOrganizationInvitationUseCase', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const actorId = '22222222-2222-4222-8222-222222222222';

  const fakeConfigService = {
    get: () => ({ webBaseUrl: 'http://localhost:3000' }),
  } as unknown as ConfigService;

  function build(
    newIds: string[] = [
      '33333333-3333-4333-8333-333333333333',
      '55555555-5555-4555-8555-555555555555',
    ],
  ) {
    const invitationRepository = new InMemoryOrganizationInvitationRepository();
    const memberRepository = new InMemoryOrganizationMemberRepository();
    const userRepository = new InMemoryUserRepository();
    const eventPublisher = new CollectingEventPublisher();
    const emailProvider = new RecordingEmailProvider();
    const useCase = new IssueOrganizationInvitationUseCase(
      invitationRepository,
      memberRepository,
      userRepository,
      new FakeOpaqueTokenService(),
      emailProvider,
      new FixedClock(now),
      new SequentialIdGenerator(newIds),
      eventPublisher,
      new ImmediateUnitOfWork(),
      new InMemorySystemConfiguration(),
      fakeConfigService,
    );
    return {
      useCase,
      invitationRepository,
      memberRepository,
      userRepository,
      eventPublisher,
      emailProvider,
    };
  }

  it('issues a Pending invitation, publishes OrganizationMemberInvited, and emails the invitee', async () => {
    const { useCase, invitationRepository, eventPublisher, emailProvider } = build();

    const result = await useCase.execute({
      organizationId,
      actorId,
      email: 'New.Member@Example.com',
      role: OrganizationMemberRole.Admin,
    });

    expect(result.status).toBe('pending');
    expect(result.email).toBe('new.member@example.com'); // canonical normalization
    expect(invitationRepository.snapshot()).toHaveLength(1);

    const event = eventPublisher.events[0] as OrganizationMemberInvitedEvent;
    expect(event).toBeInstanceOf(OrganizationMemberInvitedEvent);
    expect(event.payload).toMatchObject({
      organizationId,
      actorId,
      email: 'new.member@example.com',
      role: OrganizationMemberRole.Admin,
    });

    expect(emailProvider.calls).toHaveLength(1);
    expect(emailProvider.calls[0].to).toBe('new.member@example.com');
    expect(emailProvider.calls[0].html).toContain(
      'http://localhost:3000/invitations/accept?token=',
    );
  });

  it('rejects Owner (Section 13 - use Transfer Ownership instead)', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute({
        organizationId,
        actorId,
        email: 'new.member@example.com',
        role: OrganizationMemberRole.Owner,
      }),
    ).rejects.toBeInstanceOf(InvitationCannotGrantOwnerRoleException);
  });

  it('rejects inviting an email that already belongs to an Active member (Section 12)', async () => {
    const { useCase, userRepository, memberRepository } = build();
    const existingUser = User.create({
      id: '66666666-6666-4666-8666-666666666666',
      firstName: 'A',
      lastName: 'B',
      email: 'already.member@example.com',
      phone: null,
      username: null,
      passwordHash: 'argon2id$fake$Password123!',
      language: 'en',
      preferredCurrency: null,
      notificationOptIn: true,
      marketingOptIn: false,
      status: UserStatus.Active,
      emailVerified: true,
      failedLoginCount: 0,
      lockedUntil: null,
      permissionsVersion: 1,
      sessionVersion: 1,
      passwordChangedAt: null,
      lastLoginAt: null,
      anonymizedAt: null,
      deletionRequestedAt: null,
      scheduledAnonymizationAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    await userRepository.save(existingUser);
    await memberRepository.save(
      OrganizationMember.create({
        id: 'member-existing',
        organizationId,
        userId: '66666666-6666-4666-8666-666666666666',
        role: OrganizationMemberRole.Staff,
        status: OrganizationMemberStatus.Active,
        invitedAt: now,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await expect(
      useCase.execute({
        organizationId,
        actorId,
        email: 'already.member@example.com',
        role: OrganizationMemberRole.Admin,
      }),
    ).rejects.toBeInstanceOf(InvitationTargetAlreadyMemberException);
  });

  it('resend semantics: re-inviting the same email revokes the prior Pending invitation and issues a new one (Section 11)', async () => {
    const { useCase, invitationRepository } = build([
      '33333333-3333-4333-8333-333333333333',
      '55555555-5555-4555-8555-555555555555',
      '44444444-4444-4444-8444-444444444444',
      '77777777-7777-4777-8777-777777777777',
    ]);

    const first = await useCase.execute({
      organizationId,
      actorId,
      email: 'repeat@example.com',
      role: OrganizationMemberRole.Staff,
    });
    const second = await useCase.execute({
      organizationId,
      actorId,
      email: 'repeat@example.com',
      role: OrganizationMemberRole.Admin,
    });

    expect(first.id).not.toBe(second.id);
    const rows = invitationRepository.snapshot();
    const firstRow = rows.find((row) => row.toProps().id === first.id)!;
    const secondRow = rows.find((row) => row.toProps().id === second.id)!;
    expect(firstRow.status).toBe(OrganizationInvitationStatus.Revoked);
    expect(secondRow.status).toBe(OrganizationInvitationStatus.Pending);
  });
});
