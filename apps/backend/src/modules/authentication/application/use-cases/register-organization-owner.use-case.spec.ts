import { RegisterOrganizationOwnerUseCase } from '@modules/authentication/application/use-cases/register-organization-owner.use-case';
import { RegisterOrganizationOwnerCommand } from '@modules/authentication/application/dto/register-organization-owner.command';
import { RegistrationConsentRequiredException } from '@modules/authentication/application/exceptions/registration-consent-required.exception';
import { InvalidRegistrationInputException } from '@modules/authentication/application/exceptions/invalid-registration-input.exception';
import { EmailAlreadyExistsException } from '@modules/authentication/domain/exceptions/email-already-exists.exception';
import { OrganizationSlugAlreadyExistsException } from '@modules/organizations/domain/exceptions/organization-slug-already-exists.exception';
import { UserStatus } from '@modules/authentication/domain/enums/authentication.enums';
import { UserRegisteredEvent } from '@modules/authentication/domain/events/authentication.events';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { OrganizationRegistrationPolicy } from '@modules/organizations/domain/services/organization-registration-policy';
import { OrganizationSlug } from '@shared/domain/value-objects/organization-slug.vo';
import { OrganizationId } from '@shared/domain/value-objects/identifiers.vo';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { ConsentType } from '@modules/authentication/domain/enums/consent.enums';
import { UserConsent } from '@modules/authentication/domain/entities/user-consent.entity';
import {
  CollectingEventPublisher,
  FakeOpaqueTokenService,
  FakePasswordHasher,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryEmailVerificationRepository,
  InMemoryOrganizationMemberRepository,
  InMemoryOrganizationRepository,
  InMemorySystemConfiguration,
  InMemoryUserConsentRepository,
  InMemoryUserRepository,
  RecordingTenantContextPort,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('RegisterOrganizationOwnerUseCase', () => {
  const fixedNow = new Date('2026-07-07T12:00:00.000Z');

  const userId = '11111111-1111-4111-8111-111111111111';
  const organizationId = '22222222-2222-4222-8222-222222222222';
  const memberId = '33333333-3333-4333-8333-333333333333';
  const verificationTokenId = '44444444-4444-4444-8444-444444444444';
  const eventId = '55555555-5555-4555-8555-555555555555';
  const consentId1 = '66666666-6666-4666-8666-666666666666';
  const consentId2 = '77777777-7777-4777-8777-777777777777';

  const validCommand: RegisterOrganizationOwnerCommand = {
    email: 'owner@example.com',
    password: 'SecurePass123!',
    firstName: 'Jane',
    lastName: 'Owner',
    phone: '+963900000000',
    language: 'en',
    organizationName: 'Tavla Bistro Group',
    consents: {
      termsOfService: true,
      privacyPolicy: true,
      marketing: false,
    },
    ipAddress: '203.0.113.10',
    correlationId: 'corr-123',
  };

  function createUseCase(overrides?: {
    userRepository?: InMemoryUserRepository;
    organizationRepository?: InMemoryOrganizationRepository;
    eventPublisher?: CollectingEventPublisher;
  }) {
    const userRepository = overrides?.userRepository ?? new InMemoryUserRepository();
    const organizationRepository =
      overrides?.organizationRepository ?? new InMemoryOrganizationRepository();
    const organizationMemberRepository = new InMemoryOrganizationMemberRepository();
    const emailVerificationRepository = new InMemoryEmailVerificationRepository();
    const userConsentRepository = new InMemoryUserConsentRepository();
    const eventPublisher = overrides?.eventPublisher ?? new CollectingEventPublisher();
    const tenantContext = new RecordingTenantContextPort();

    const useCase = new RegisterOrganizationOwnerUseCase(
      userRepository,
      organizationRepository,
      organizationMemberRepository,
      emailVerificationRepository,
      userConsentRepository,
      new FakePasswordHasher(),
      new FakeOpaqueTokenService(),
      new ImmediateUnitOfWork(),
      eventPublisher,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([
        userId,
        organizationId,
        memberId,
        verificationTokenId,
        consentId1,
        consentId2,
        eventId,
      ]),
      new InMemorySystemConfiguration({
        emailVerificationTokenTtlHours: 24,
        termsOfServiceVersion: '2.0',
        privacyPolicyVersion: '2.1',
      }),
      tenantContext,
    );

    return {
      useCase,
      userRepository,
      organizationRepository,
      organizationMemberRepository,
      emailVerificationRepository,
      userConsentRepository,
      eventPublisher,
      tenantContext,
    };
  }

  it('registers an organization owner in a single transaction', async () => {
    const {
      useCase,
      userRepository,
      organizationRepository,
      organizationMemberRepository,
      emailVerificationRepository,
      userConsentRepository,
      eventPublisher,
      tenantContext,
    } = createUseCase();

    const result = await useCase.execute(validCommand);

    expect(result).toEqual({
      userId,
      email: 'owner@example.com',
      status: UserStatus.Pending,
      organizationId,
      organizationSlug: 'tavla-bistro-group',
      organizationName: 'Tavla Bistro Group',
    });

    const savedUser = (await userRepository.findByEmail(Email.create('owner@example.com')))!;
    expect(savedUser.status).toBe(UserStatus.Pending);
    expect(savedUser.emailVerified).toBe(false);
    expect(savedUser.passwordHash.value).toBe('argon2id$fake$SecurePass123!');

    const savedOrganization = (await organizationRepository.findById(
      OrganizationId.create(organizationId),
    ))!;
    expect(savedOrganization.organizationId.value).toBe(organizationId);
    expect(savedOrganization.slug.value).toBe('tavla-bistro-group');
    expect(savedOrganization.toProps().billingEmail).toBe('owner@example.com');

    const members = organizationMemberRepository.snapshot();
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe(OrganizationMemberRole.Owner);
    expect(members[0].userId.value).toBe(userId);

    expect(userConsentRepository.consents).toHaveLength(2);
    expect(userConsentRepository.consents.map((c: UserConsent) => c.consentType)).toEqual([
      ConsentType.TermsOfService,
      ConsentType.PrivacyPolicy,
    ]);

    expect(emailVerificationRepository.tokens).toHaveLength(1);
    expect(emailVerificationRepository.tokens[0]).toMatchObject({
      userId,
      tokenHash: 'sha256-opaque-token-1',
      consumedAt: null,
    });
    expect(emailVerificationRepository.tokens[0].expiresAt.getTime()).toBe(
      fixedNow.getTime() + 24 * 3_600_000,
    );

    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(UserRegisteredEvent);
    expect((eventPublisher.events[0] as UserRegisteredEvent).payload).toEqual({
      userId,
      email: 'owner@example.com',
    });

    // Phase 2.13.1: the bootstrap tenant identity must come from the
    // organization this exact call just created, not from any client input.
    expect(tenantContext.boundContexts).toHaveLength(1);
    expect(tenantContext.boundContexts[0]).toEqual({
      organizationId,
      userId,
      correlationId: 'corr-123',
    });
  });

  it('rejects registration when required consents are missing', async () => {
    const { useCase } = createUseCase();

    await expect(
      useCase.execute({
        ...validCommand,
        consents: { termsOfService: false, privacyPolicy: true },
      }),
    ).rejects.toBeInstanceOf(RegistrationConsentRequiredException);
  });

  it('rejects duplicate email addresses', async () => {
    const userRepository = new InMemoryUserRepository();
    const existingUserId = '99999999-9999-4999-8999-999999999999';
    const existing = RegistrationPolicy.createPendingUser({
      id: existingUserId,
      email: Email.create('owner@example.com'),
      passwordHash: PasswordHash.create('argon2id$existing'),
      firstName: 'Existing',
      lastName: 'User',
      phone: null,
      language: 'en',
      at: fixedNow,
    });
    await userRepository.save(existing);

    const { useCase } = createUseCase({ userRepository });

    await expect(useCase.execute(validCommand)).rejects.toBeInstanceOf(EmailAlreadyExistsException);
  });

  it('rejects duplicate organization slugs', async () => {
    const organizationRepository = new InMemoryOrganizationRepository();

    await organizationRepository.save(
      OrganizationRegistrationPolicy.createForOwner({
        id: organizationId,
        name: 'Existing Org',
        slug: OrganizationSlug.create('tavla-bistro-group'),
        billingEmail: Email.create('existing@example.com'),
        at: fixedNow,
      }),
    );

    const { useCase } = createUseCase({ organizationRepository });

    await expect(useCase.execute(validCommand)).rejects.toBeInstanceOf(
      OrganizationSlugAlreadyExistsException,
    );
  });

  it('uses an explicit organization slug when provided', async () => {
    const { useCase } = createUseCase();

    const result = await useCase.execute({
      ...validCommand,
      email: 'custom@example.com',
      organizationSlug: 'my-custom-slug',
    });

    expect(result.organizationSlug).toBe('my-custom-slug');
  });

  it('rejects a blank first name', async () => {
    const { useCase } = createUseCase();

    await expect(
      useCase.execute({ ...validCommand, email: 'blank-first@example.com', firstName: '   ' }),
    ).rejects.toBeInstanceOf(InvalidRegistrationInputException);
  });

  it('rejects a blank last name', async () => {
    const { useCase } = createUseCase();

    await expect(
      useCase.execute({ ...validCommand, email: 'blank-last@example.com', lastName: '' }),
    ).rejects.toBeInstanceOf(InvalidRegistrationInputException);
  });

  it('rejects a blank organization name', async () => {
    const { useCase } = createUseCase();

    await expect(
      useCase.execute({
        ...validCommand,
        email: 'blank-org@example.com',
        organizationName: '  ',
      }),
    ).rejects.toBeInstanceOf(InvalidRegistrationInputException);
  });

  it('rejects a blank IP address', async () => {
    const { useCase } = createUseCase();

    await expect(
      useCase.execute({ ...validCommand, email: 'blank-ip@example.com', ipAddress: '' }),
    ).rejects.toBeInstanceOf(InvalidRegistrationInputException);
  });

  it('records an optional marketing consent when accepted', async () => {
    // A dedicated instance with one extra id (buildConsents needs a 3rd id
    // for the marketing consent, ahead of the shared helper's fixed 7-id
    // list sized for the 2-consent default case used everywhere else).
    const userConsentRepository = new InMemoryUserConsentRepository();
    const useCase = new RegisterOrganizationOwnerUseCase(
      new InMemoryUserRepository(),
      new InMemoryOrganizationRepository(),
      new InMemoryOrganizationMemberRepository(),
      new InMemoryEmailVerificationRepository(),
      userConsentRepository,
      new FakePasswordHasher(),
      new FakeOpaqueTokenService(),
      new ImmediateUnitOfWork(),
      new CollectingEventPublisher(),
      new FixedClock(fixedNow),
      new SequentialIdGenerator([
        userId,
        organizationId,
        memberId,
        verificationTokenId,
        consentId1,
        consentId2,
        '88888888-8888-4888-8888-888888888888',
        eventId,
      ]),
      new InMemorySystemConfiguration({
        emailVerificationTokenTtlHours: 24,
        termsOfServiceVersion: '2.0',
        privacyPolicyVersion: '2.1',
      }),
      new RecordingTenantContextPort(),
    );

    await useCase.execute({
      ...validCommand,
      email: 'marketing@example.com',
      consents: { termsOfService: true, privacyPolicy: true, marketing: true },
    });

    const types = userConsentRepository.consents.map((consent) => consent.toProps().consentType);
    expect(types).toContain(ConsentType.Marketing);
  });
});
