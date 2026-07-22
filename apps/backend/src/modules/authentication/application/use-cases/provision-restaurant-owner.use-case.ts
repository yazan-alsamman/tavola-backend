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
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { UserRepository } from '../../domain/repositories/authentication.repositories';
import { UserConsentRepository } from '../../domain/repositories/user-consent.repository';
import { PasswordHasher } from '../../domain/services/password-hasher.port';
import { User } from '../../domain/entities/user.entity';
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
import {
  ProvisionRestaurantOwnerCommand,
  ProvisionRestaurantOwnerResult,
} from '../dto/provision-restaurant-owner.command';
import { RegistrationConsentRequiredException } from '../exceptions/registration-consent-required.exception';
import { InvalidRegistrationInputException } from '../exceptions/invalid-registration-input.exception';
import { resolveOrganizationSlug } from '../utils/organization-slug.util';
import {
  CLOCK,
  EVENT_PUBLISHER,
  ID_GENERATOR,
  PASSWORD_HASHER,
  SYSTEM_CONFIGURATION,
  UNIT_OF_WORK,
  USER_CONSENT_REPOSITORY,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';

/**
 * ADR-022 §"Restaurant Owner Provisioning Lifecycle" / Decision #1/#3/#15.
 * Reuses `RegisterOrganizationOwnerUseCase`'s exact transactional shape
 * (User + Organization + OrganizationMember(Owner) + UserConsent, one
 * transaction) minus the email-verification-token step: the Owner is
 * created directly `Active`/`emailVerified: true` (no verification token,
 * no verification step - AUTHENTICATION_ARCHITECTURE.md §15.2), invoked by
 * an authenticated Platform Admin action, never a public/anonymous request.
 * Password delivery to the Owner is explicitly out of backend scope
 * (Decision #15) - this use case only hashes and persists the password the
 * Platform Admin supplied.
 */
@Injectable()
export class ProvisionRestaurantOwnerUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    @Inject(ORGANIZATION_MEMBER_REPOSITORY)
    private readonly organizationMemberRepository: OrganizationMemberRepository,
    @Inject(USER_CONSENT_REPOSITORY) private readonly userConsentRepository: UserConsentRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: ProvisionRestaurantOwnerCommand): Promise<ProvisionRestaurantOwnerResult> {
    this.validateCommand(command);

    const email = Email.create(command.email);
    const password = Password.create(command.password);
    const slugRaw = resolveOrganizationSlug(command.organizationName, command.organizationSlug);
    const organizationSlug = OrganizationSlug.create(slugRaw);

    const existingOrganization = await this.organizationRepository.findBySlug(organizationSlug);
    if (existingOrganization !== null) {
      throw new OrganizationSlugAlreadyExistsException(organizationSlug);
    }

    const now = this.clock.now();
    const userId = UserId.create(this.idGenerator.generate());
    const organizationId = OrganizationId.create(this.idGenerator.generate());
    const memberId = this.idGenerator.generate();

    const passwordHash = await this.passwordHasher.hash(password);
    // No verification token, no `Pending` status - an administratively
    // provisioned Owner is immediately Active/emailVerified (Decision #1:
    // "an administratively-created account is immediately eligible to
    // authenticate").
    const user = User.create({
      id: userId.value,
      firstName: command.firstName.trim(),
      lastName: command.lastName.trim(),
      email: email.value,
      phone: command.phone?.trim() ?? null,
      username: null,
      passwordHash: passwordHash.value,
      language: command.language?.trim() || 'en',
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
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
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

    // Same tenant-bootstrap reasoning as RegisterOrganizationOwnerUseCase:
    // this is the operation that CREATES the Organization, so no JWT/
    // interceptor-bound TenantContext can exist yet - organizationId here is
    // this use case's own server-generated id, never client input.
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
        }),
    );

    await this.auditLogWriter.record({
      actorId: command.provisionedByPlatformAdminId,
      actorType: 'User',
      action: 'platform_admin.restaurant_owner.provisioned',
      targetType: 'User',
      targetId: userId.value,
      organizationId: organizationId.value,
      correlationId: command.correlationId ?? null,
      ipAddress: command.ipAddress,
      occurredAt: now,
    });

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
      organizationId: organizationId.value,
      organizationSlug: organizationSlug.value,
      organizationName: organization.toProps().name,
    };
  }

  private validateCommand(command: ProvisionRestaurantOwnerCommand): void {
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
    command: ProvisionRestaurantOwnerCommand,
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
