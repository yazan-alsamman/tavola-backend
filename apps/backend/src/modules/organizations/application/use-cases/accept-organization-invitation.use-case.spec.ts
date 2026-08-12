import { AcceptOrganizationInvitationUseCase } from './accept-organization-invitation.use-case';
import { OrganizationInvitation } from '../../domain/entities/organization-invitation.entity';
import { Organization } from '../../domain/entities/organization.entity';
import { OrganizationMember } from '../../domain/entities/organization-member.entity';
import {
  OrganizationMemberRole,
  OrganizationMemberStatus,
  OrganizationInvitationStatus,
  OrganizationStatus,
} from '../../domain/enums/organization.enums';
import { User } from '@modules/authentication/domain/entities/user.entity';
import { UserStatus } from '@modules/authentication/domain/enums/authentication.enums';
import { InvalidInvitationTokenException } from '../../domain/exceptions/invalid-invitation-token.exception';
import { ExpiredInvitationTokenException } from '../../domain/exceptions/expired-invitation-token.exception';
import { InvitationEmailMismatchException } from '../../domain/exceptions/invitation-email-mismatch.exception';
import { InvitationRequiresLoginException } from '../../domain/exceptions/invitation-requires-login.exception';
import { InvitationOrganizationUnavailableException } from '../../domain/exceptions/invitation-organization-unavailable.exception';
import { InvitationTargetAlreadyMemberException } from '../../domain/exceptions/invitation-target-already-member.exception';
import { InvalidRegistrationInputException } from '@modules/authentication/application/exceptions/invalid-registration-input.exception';
import { OrganizationInvitationAcceptedEvent } from '../../domain/events/organization.events';
import {
  CollectingEventPublisher,
  FakeOpaqueTokenService,
  FakePasswordHasher,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryOrganizationInvitationRepository,
  InMemoryOrganizationMemberRepository,
  InMemoryOrganizationRepository,
  InMemoryUserRepository,
  RecordingTenantContextPort,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('AcceptOrganizationInvitationUseCase', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const RAW_TOKEN = 'the-raw-token';

  function buildOrganization(overrides: Partial<Parameters<typeof Organization.create>[0]> = {}) {
    return Organization.create({
      id: organizationId,
      name: 'Acme',
      slug: 'acme',
      status: OrganizationStatus.Active,
      billingEmail: 'billing@acme.example.com',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      ...overrides,
    });
  }

  function buildInvitation(
    overrides: Partial<Parameters<typeof OrganizationInvitation.create>[0]> = {},
  ) {
    const opaqueTokenService = new FakeOpaqueTokenService();
    return OrganizationInvitation.create({
      id: 'invitation-1',
      organizationId,
      email: 'invitee@example.com',
      role: OrganizationMemberRole.Admin,
      tokenHash: opaqueTokenService.hash(RAW_TOKEN),
      invitedByUserId: 'inviter-1',
      status: OrganizationInvitationStatus.Pending,
      expiresAt: new Date(now.getTime() + 3_600_000),
      acceptedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  }

  function buildUser(overrides: Partial<Parameters<typeof User.create>[0]> = {}) {
    return User.create({
      id: 'b0000000-0000-4000-8000-000000000001',
      firstName: 'Existing',
      lastName: 'User',
      email: 'invitee@example.com',
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
      ...overrides,
    });
  }

  const DEFAULT_GENERATED_IDS = [
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000004',
    'a0000000-0000-4000-8000-000000000005',
    'a0000000-0000-4000-8000-000000000006',
  ];

  function build(newIds: string[] = DEFAULT_GENERATED_IDS) {
    const invitationRepository = new InMemoryOrganizationInvitationRepository();
    const organizationRepository = new InMemoryOrganizationRepository();
    const memberRepository = new InMemoryOrganizationMemberRepository();
    const userRepository = new InMemoryUserRepository();
    const eventPublisher = new CollectingEventPublisher();
    const tenantContext = new RecordingTenantContextPort();
    const useCase = new AcceptOrganizationInvitationUseCase(
      invitationRepository,
      organizationRepository,
      memberRepository,
      userRepository,
      new FakeOpaqueTokenService(),
      new FakePasswordHasher(),
      new FixedClock(now),
      new SequentialIdGenerator(newIds),
      eventPublisher,
      new ImmediateUnitOfWork(),
      tenantContext,
    );
    return {
      useCase,
      invitationRepository,
      organizationRepository,
      memberRepository,
      userRepository,
      eventPublisher,
      tenantContext,
    };
  }

  // ---------------------------------------------------------------------
  // Token validity
  // ---------------------------------------------------------------------

  it('rejects an unknown token (not found)', async () => {
    const { useCase, organizationRepository } = build();
    await organizationRepository.save(buildOrganization());

    await expect(
      useCase.execute({ token: 'garbage', authenticatedUserId: null }),
    ).rejects.toBeInstanceOf(InvalidInvitationTokenException);
  });

  it('rejects an expired token with a distinguishable error (Section 10)', async () => {
    const { useCase, invitationRepository, organizationRepository } = build();
    await organizationRepository.save(buildOrganization());
    await invitationRepository.save(buildInvitation({ expiresAt: new Date(now.getTime() - 1) }));

    await expect(
      useCase.execute({ token: RAW_TOKEN, authenticatedUserId: null }),
    ).rejects.toBeInstanceOf(ExpiredInvitationTokenException);
  });

  it('rejects an already-accepted token indistinguishably from "not found" (anti-enumeration)', async () => {
    const { useCase, invitationRepository, organizationRepository } = build();
    await organizationRepository.save(buildOrganization());
    await invitationRepository.save(
      buildInvitation({ status: OrganizationInvitationStatus.Accepted, acceptedAt: now }),
    );

    await expect(
      useCase.execute({ token: RAW_TOKEN, authenticatedUserId: null }),
    ).rejects.toBeInstanceOf(InvalidInvitationTokenException);
  });

  it('rejects a revoked token indistinguishably from "not found" (anti-enumeration)', async () => {
    const { useCase, invitationRepository, organizationRepository } = build();
    await organizationRepository.save(buildOrganization());
    await invitationRepository.save(
      buildInvitation({ status: OrganizationInvitationStatus.Revoked }),
    );

    await expect(
      useCase.execute({ token: RAW_TOKEN, authenticatedUserId: null }),
    ).rejects.toBeInstanceOf(InvalidInvitationTokenException);
  });

  it('rejects replay - accepting the same token twice', async () => {
    const { useCase, invitationRepository, organizationRepository, userRepository } = build();
    await organizationRepository.save(buildOrganization());
    await invitationRepository.save(buildInvitation());
    const existingUser = buildUser();
    await userRepository.save(existingUser);

    await useCase.execute({ token: RAW_TOKEN, authenticatedUserId: existingUser.userId.value });

    await expect(
      useCase.execute({ token: RAW_TOKEN, authenticatedUserId: existingUser.userId.value }),
    ).rejects.toBeInstanceOf(InvalidInvitationTokenException);
  });

  // ---------------------------------------------------------------------
  // Organization availability
  // ---------------------------------------------------------------------

  it('rejects acceptance when the Organization was deleted after issuance', async () => {
    const { useCase, invitationRepository, organizationRepository } = build();
    await organizationRepository.save(buildOrganization({ deletedAt: now }));
    await invitationRepository.save(buildInvitation());

    await expect(
      useCase.execute({
        token: RAW_TOKEN,
        authenticatedUserId: null,
        firstName: 'A',
        lastName: 'B',
        password: 'ValidPassw0rd!',
      }),
    ).rejects.toBeInstanceOf(InvitationOrganizationUnavailableException);
  });

  it('rejects acceptance when the Organization was suspended after issuance', async () => {
    const { useCase, invitationRepository, organizationRepository } = build();
    await organizationRepository.save(buildOrganization({ status: OrganizationStatus.Suspended }));
    await invitationRepository.save(buildInvitation());

    await expect(
      useCase.execute({
        token: RAW_TOKEN,
        authenticatedUserId: null,
        firstName: 'A',
        lastName: 'B',
        password: 'ValidPassw0rd!',
      }),
    ).rejects.toBeInstanceOf(InvitationOrganizationUnavailableException);
  });

  // ---------------------------------------------------------------------
  // Section 7 - existing account
  // ---------------------------------------------------------------------

  it('requires login when the invited email already has an account and the caller is anonymous', async () => {
    const { useCase, invitationRepository, organizationRepository, userRepository } = build();
    await organizationRepository.save(buildOrganization());
    await invitationRepository.save(buildInvitation());
    await userRepository.save(buildUser());

    await expect(
      useCase.execute({ token: RAW_TOKEN, authenticatedUserId: null }),
    ).rejects.toBeInstanceOf(InvitationRequiresLoginException);
  });

  it('rejects a logged-in User accepting an invitation addressed to a different email (Section 7)', async () => {
    const { useCase, invitationRepository, organizationRepository, userRepository } = build();
    await organizationRepository.save(buildOrganization());
    await invitationRepository.save(buildInvitation());
    await userRepository.save(buildUser());

    await expect(
      useCase.execute({ token: RAW_TOKEN, authenticatedUserId: 'someone-else-entirely' }),
    ).rejects.toBeInstanceOf(InvitationEmailMismatchException);
  });

  it('creates the OrganizationMember for the correct authenticated existing User, without creating a new User', async () => {
    const {
      useCase,
      invitationRepository,
      organizationRepository,
      userRepository,
      memberRepository,
      eventPublisher,
      tenantContext,
    } = build();
    await organizationRepository.save(buildOrganization());
    await invitationRepository.save(buildInvitation());
    const existingUser = buildUser();
    await userRepository.save(existingUser);

    const result = await useCase.execute({
      token: RAW_TOKEN,
      authenticatedUserId: existingUser.userId.value,
    });

    expect(result.accountCreated).toBe(false);
    expect(result.userId).toBe(existingUser.userId.value);
    expect(result.organizationId).toBe(organizationId);
    expect(userRepository.snapshot()).toHaveLength(1); // no new User created

    const member = memberRepository.snapshot()[0];
    expect(member.toProps()).toMatchObject({
      organizationId,
      userId: existingUser.userId.value,
      role: OrganizationMemberRole.Admin,
      status: OrganizationMemberStatus.Active,
    });

    const event = eventPublisher.events[0] as OrganizationInvitationAcceptedEvent;
    expect(event).toBeInstanceOf(OrganizationInvitationAcceptedEvent);
    expect(event.payload.accountCreated).toBe(false);

    expect(tenantContext.boundContexts[0]).toMatchObject({
      organizationId,
      userId: existingUser.userId.value,
    });

    const invitationRow = invitationRepository.snapshot()[0];
    expect(invitationRow.status).toBe(OrganizationInvitationStatus.Accepted);
  });

  it('rejects when the invited (already-member) email already holds an Active membership in this Organization', async () => {
    const {
      useCase,
      invitationRepository,
      organizationRepository,
      userRepository,
      memberRepository,
    } = build();
    await organizationRepository.save(buildOrganization());
    await invitationRepository.save(buildInvitation());
    const existingUser = buildUser();
    await userRepository.save(existingUser);
    await memberRepository.save(
      OrganizationMember.create({
        id: 'already-member',
        organizationId,
        userId: existingUser.userId.value,
        role: OrganizationMemberRole.Staff,
        status: OrganizationMemberStatus.Active,
        invitedAt: now,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await expect(
      useCase.execute({ token: RAW_TOKEN, authenticatedUserId: existingUser.userId.value }),
    ).rejects.toBeInstanceOf(InvitationTargetAlreadyMemberException);
  });

  it('reactivates a previously-Removed membership instead of creating a duplicate row', async () => {
    const {
      useCase,
      invitationRepository,
      organizationRepository,
      userRepository,
      memberRepository,
    } = build();
    await organizationRepository.save(buildOrganization());
    await invitationRepository.save(buildInvitation());
    const existingUser = buildUser();
    await userRepository.save(existingUser);
    await memberRepository.save(
      OrganizationMember.create({
        id: 'removed-member',
        organizationId,
        userId: existingUser.userId.value,
        role: OrganizationMemberRole.Staff,
        status: OrganizationMemberStatus.Removed,
        invitedAt: now,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const result = await useCase.execute({
      token: RAW_TOKEN,
      authenticatedUserId: existingUser.userId.value,
    });

    expect(result.memberId).toBe('removed-member');
    expect(memberRepository.snapshot()).toHaveLength(1);
    expect(memberRepository.snapshot()[0].status).toBe(OrganizationMemberStatus.Active);
    expect(memberRepository.snapshot()[0].role).toBe(OrganizationMemberRole.Admin);
  });

  // ---------------------------------------------------------------------
  // Section 8 - new account
  // ---------------------------------------------------------------------

  it('creates a new User + OrganizationMember atomically when the invited email has no account', async () => {
    const {
      useCase,
      invitationRepository,
      organizationRepository,
      userRepository,
      memberRepository,
      eventPublisher,
    } = build();
    await organizationRepository.save(buildOrganization());
    await invitationRepository.save(buildInvitation());

    const result = await useCase.execute({
      token: RAW_TOKEN,
      authenticatedUserId: null,
      firstName: 'Jane',
      lastName: 'Doe',
      password: 'ValidPassw0rd!',
    });

    expect(result.accountCreated).toBe(true);
    const createdUser = userRepository.snapshot()[0];
    expect(createdUser.email?.value).toBe('invitee@example.com'); // always the invited email
    expect(createdUser.emailVerified).toBe(true);
    expect(createdUser.userId.value).toBe(result.userId);

    const member = memberRepository.snapshot()[0];
    expect(member.userId.value).toBe(createdUser.userId.value);

    const event = eventPublisher.events[0] as OrganizationInvitationAcceptedEvent;
    expect(event.payload.accountCreated).toBe(true);
  });

  it('ignores a client-supplied email and never lets the client replace the invited email (Section 8)', async () => {
    const { useCase, invitationRepository, organizationRepository, userRepository } = build();
    await organizationRepository.save(buildOrganization());
    await invitationRepository.save(buildInvitation());

    // AcceptOrganizationInvitationCommand has no `email` field at all - this
    // test documents that invariant structurally (a TS compile error would
    // occur if one were added and wired through) rather than at runtime.
    await useCase.execute({
      token: RAW_TOKEN,
      authenticatedUserId: null,
      firstName: 'Jane',
      lastName: 'Doe',
      password: 'ValidPassw0rd!',
    });

    expect(userRepository.snapshot()[0].email?.value).toBe('invitee@example.com');
  });

  it('rejects new-account acceptance missing firstName/lastName/password', async () => {
    const { useCase, invitationRepository, organizationRepository } = build();
    await organizationRepository.save(buildOrganization());
    await invitationRepository.save(buildInvitation());

    await expect(
      useCase.execute({ token: RAW_TOKEN, authenticatedUserId: null }),
    ).rejects.toBeInstanceOf(InvalidRegistrationInputException);
  });

  // ---------------------------------------------------------------------
  // Concurrency (Section 16/17) - `consumeIfPending`'s CAS (`WHERE id = ?
  // AND status = 'Pending'`) is the actual mechanism that decides the
  // winner between two truly concurrent requests; a synchronous in-memory
  // fake cannot reproduce real interleaving, so this exercises the CAS
  // primitive directly (mirrors how PrismaOrganizationInvitationRepository's
  // own `updateMany`-based implementation behaves under a real race), while
  // the "rejects replay" test above proves the use case surfaces its
  // failure as the correct, anti-enumeration-collapsed exception.
  // ---------------------------------------------------------------------

  it('consumeIfPending only lets the first of two racing CAS attempts succeed', async () => {
    const { invitationRepository, organizationRepository, userRepository } = build();
    await organizationRepository.save(buildOrganization());
    await invitationRepository.save(buildInvitation());
    await userRepository.save(buildUser());

    const [firstOutcome, secondOutcome] = await Promise.all([
      invitationRepository.consumeIfPending('invitation-1', now),
      invitationRepository.consumeIfPending('invitation-1', now),
    ]);

    expect([firstOutcome, secondOutcome].filter(Boolean)).toHaveLength(1);
  });
});
