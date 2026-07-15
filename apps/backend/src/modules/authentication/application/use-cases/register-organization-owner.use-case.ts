import { Inject, Injectable } from '@nestjs/common';
import { Email } from '@shared/domain/value-objects/email.vo';
import { Password } from '@shared/domain/value-objects/password.vo';
import { OrganizationSlug } from '@shared/domain/value-objects/organization-slug.vo';
import { OrganizationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort } from '@shared/application/ports/clock.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import {
  SYSTEM_CONFIG_KEYS,
  SystemConfigurationPort,
} from '@shared/application/ports/system-configuration.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import {
  TenantContextPort,
  TENANT_CONTEXT_PORT,
} from '@shared/application/ports/tenant-context.port';
import { UserRepository } from '../../domain/repositories/authentication.repositories';
import { EmailVerificationRepository } from '../../domain/repositories/authentication.repositories';
import { UserConsentRepository } from '../../domain/repositories/user-consent.repository';
import { PasswordHasher } from '../../domain/services/password-hasher.port';
import { OpaqueTokenService } from '../../domain/services/opaque-token.port';
import { RegistrationPolicy } from '../../domain/services/registration-policy';
import { UserRegisteredEvent } from '../../domain/events/authentication.events';
import { UserConsent } from '../../domain/entities/user-consent.entity';
import { ConsentType } from '../../domain/enums/consent.enums';
import { UserStatus } from '../../domain/enums/authentication.enums';
import { OrganizationRepository } from '@modules/organizations/domain/repositories/organization.repository';
import { OrganizationMemberRepository } from '@modules/organizations/domain/repositories/organization.repository';
import {
  ORGANIZATION_MEMBER_REPOSITORY,
  ORGANIZATION_REPOSITORY,
} from '@modules/organizations/application/tokens/organizations.tokens';
import { OrganizationRegistrationPolicy } from '@modules/organizations/domain/services/organization-registration-policy';
import { OrganizationMembershipPolicy } from '@modules/organizations/domain/services/organization-membership-policy';
import { OrganizationSlugAlreadyExistsException } from '@modules/organizations/domain/exceptions/organization-slug-already-exists.exception';
import { RegisterOrganizationOwnerCommand } from '../dto/register-organization-owner.command';
import { RegisterOrganizationOwnerResult } from '../dto/register-organization-owner.result';
import { RegistrationConsentRequiredException } from '../exceptions/registration-consent-required.exception';
import { InvalidRegistrationInputException } from '../exceptions/invalid-registration-input.exception';
import { resolveOrganizationSlug } from '../utils/organization-slug.util';
import {
  CLOCK,
  EMAIL_VERIFICATION_REPOSITORY,
  EVENT_PUBLISHER,
  ID_GENERATOR,
  OPAQUE_TOKEN_SERVICE,
  PASSWORD_HASHER,
  SYSTEM_CONFIGURATION,
  UNIT_OF_WORK,
  USER_CONSENT_REPOSITORY,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';

@Injectable()
export class RegisterOrganizationOwnerUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    @Inject(ORGANIZATION_MEMBER_REPOSITORY)
    private readonly organizationMemberRepository: OrganizationMemberRepository,
    @Inject(EMAIL_VERIFICATION_REPOSITORY)
    private readonly emailVerificationRepository: EmailVerificationRepository,
    @Inject(USER_CONSENT_REPOSITORY) private readonly userConsentRepository: UserConsentRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(OPAQUE_TOKEN_SERVICE) private readonly opaqueTokenService: OpaqueTokenService,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(
    command: RegisterOrganizationOwnerCommand,
  ): Promise<RegisterOrganizationOwnerResult> {
    this.validateCommand(command);

    const email = Email.create(command.email);
    const password = Password.create(command.password);
    const slugRaw = resolveOrganizationSlug(command.organizationName, command.organizationSlug);
    const organizationSlug = OrganizationSlug.create(slugRaw);

    // Email uniqueness is enforced by the database's unique constraint on
    // users.email, not by a pre-check here: two concurrent registrations for
    // the same email would otherwise both pass a check-then-act existence
    // check before either commits. `userRepository.save` (below, inside the
    // transaction) throws EmailAlreadyExistsException when the constraint is
    // violated, which is the only race-safe place to detect the conflict.
    const existingOrganization = await this.organizationRepository.findBySlug(organizationSlug);
    if (existingOrganization !== null) {
      throw new OrganizationSlugAlreadyExistsException(organizationSlug);
    }

    const now = this.clock.now();
    const userId = UserId.create(this.idGenerator.generate());
    const organizationId = OrganizationId.create(this.idGenerator.generate());
    const memberId = this.idGenerator.generate();
    const verificationTokenId = this.idGenerator.generate();

    const passwordHash = await this.passwordHasher.hash(password);
    const user = RegistrationPolicy.createPendingUser({
      id: userId.value,
      email,
      passwordHash,
      firstName: command.firstName,
      lastName: command.lastName,
      phone: command.phone?.trim() ?? null,
      language: command.language?.trim() || 'en',
      at: now,
    });

    const organization = OrganizationRegistrationPolicy.createForOwner({
      id: organizationId.value,
      name: command.organizationName,
      slug: organizationSlug,
      billingEmail: email,
      at: now,
    });

    const ownerMembership = OrganizationMembershipPolicy.createOwnerMembership(
      { organizationId, userId, at: now },
      memberId,
    );

    const termsVersion = await this.systemConfiguration.getString(
      SYSTEM_CONFIG_KEYS.termsOfServiceVersion,
      '1.0',
    );
    const privacyVersion = await this.systemConfiguration.getString(
      SYSTEM_CONFIG_KEYS.privacyPolicyVersion,
      '1.0',
    );

    const consents = this.buildConsents(userId.value, command, termsVersion, privacyVersion, now);

    const verificationTtlHours = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.emailVerificationTokenTtlHours,
      24,
    );
    const opaqueVerificationToken = this.opaqueTokenService.generate();
    const verificationTokenHash = this.opaqueTokenService.hash(opaqueVerificationToken);
    const verificationExpiresAt = new Date(now.getTime() + verificationTtlHours * 3_600_000);

    // Registration is the one place tenant identity must be established by
    // the application layer itself rather than by TenantContextInterceptor:
    // this is the bootstrap operation that CREATES the Organization, so no
    // JWT (and therefore no interceptor-bound TenantContext) can exist yet.
    // `organizationId` below is the id this very use case just generated
    // server-side (never client input) - the only trustworthy source of
    // tenant identity available during bootstrap. Binding it here lets
    // `organizationMemberRepository.save` (which now goes through the
    // tenant-scoped Prisma client, Phase 2.13.1) inject/verify it instead of
    // failing closed with TenantContextMissingException.
    await this.tenantContext.runAsync(
      {
        organizationId: organizationId.value,
        userId: userId.value,
        correlationId: command.correlationId ?? memberId,
      },
      () =>
        this.unitOfWork.execute(async () => {
          await this.userRepository.save(user);
          await this.organizationRepository.save(organization);
          await this.organizationMemberRepository.save(ownerMembership);
          await this.userConsentRepository.saveMany(consents);
          await this.emailVerificationRepository.invalidateActiveByUserId(userId);
          await this.emailVerificationRepository.save({
            id: verificationTokenId,
            userId: userId.value,
            tokenHash: verificationTokenHash,
            expiresAt: verificationExpiresAt,
            consumedAt: null,
            createdAt: now,
          });
        }),
    );

    await this.eventPublisher.publish(
      new UserRegisteredEvent(
        this.idGenerator.generate(),
        { userId: userId.value, email: email.value },
        now,
        command.correlationId,
      ),
    );

    return {
      userId: userId.value,
      email: email.value,
      status: UserStatus.Pending,
      organizationId: organizationId.value,
      organizationSlug: organizationSlug.value,
      organizationName: organization.toProps().name,
    };
  }

  private validateCommand(command: RegisterOrganizationOwnerCommand): void {
    if (!command.consents.termsOfService || !command.consents.privacyPolicy) {
      throw new RegistrationConsentRequiredException();
    }

    if (command.firstName.trim().length === 0) {
      throw new InvalidRegistrationInputException('First name is required.');
    }

    if (command.lastName.trim().length === 0) {
      throw new InvalidRegistrationInputException('Last name is required.');
    }

    if (command.organizationName.trim().length === 0) {
      throw new InvalidRegistrationInputException('Organization name is required.');
    }

    if (command.ipAddress.trim().length === 0) {
      throw new InvalidRegistrationInputException('IP address is required for consent recording.');
    }
  }

  private buildConsents(
    userId: string,
    command: RegisterOrganizationOwnerCommand,
    termsVersion: string,
    privacyVersion: string,
    at: Date,
  ): UserConsent[] {
    const consents: UserConsent[] = [
      UserConsent.create({
        id: this.idGenerator.generate(),
        userId,
        consentType: ConsentType.TermsOfService,
        termsVersion,
        consentedAt: at,
        ipAddress: command.ipAddress,
      }),
      UserConsent.create({
        id: this.idGenerator.generate(),
        userId,
        consentType: ConsentType.PrivacyPolicy,
        termsVersion: privacyVersion,
        consentedAt: at,
        ipAddress: command.ipAddress,
      }),
    ];

    if (command.consents.marketing === true) {
      consents.push(
        UserConsent.create({
          id: this.idGenerator.generate(),
          userId,
          consentType: ConsentType.Marketing,
          termsVersion: '1.0',
          consentedAt: at,
          ipAddress: command.ipAddress,
        }),
      );
    }

    return consents;
  }
}
