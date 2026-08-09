import { Inject, Injectable } from '@nestjs/common';
import { Email } from '@shared/domain/value-objects/email.vo';
import { Password } from '@shared/domain/value-objects/password.vo';
import { OrganizationSlug } from '@shared/domain/value-objects/organization-slug.vo';
import { OrganizationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  SYSTEM_CONFIG_KEYS,
  SystemConfigurationPort,
} from '@shared/application/ports/system-configuration.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
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
import { Subscription } from '@modules/subscriptions/domain/entities/subscription.entity';
import { SubscriptionUsage } from '@modules/subscriptions/domain/entities/subscription-usage.entity';
import {
  SubscriptionRepository,
  SUBSCRIPTION_REPOSITORY,
} from '@modules/subscriptions/domain/repositories/subscription.repository';
import {
  SubscriptionPlanRepository,
  SUBSCRIPTION_PLAN_REPOSITORY,
} from '@modules/subscriptions/domain/repositories/subscription-plan.repository';
import {
  SubscriptionUsageRepository,
  SUBSCRIPTION_USAGE_REPOSITORY,
} from '@modules/subscriptions/domain/repositories/subscription-usage.repository';
import { SubscriptionPlanNotFoundException } from '@modules/subscriptions/domain/exceptions/subscription-plan-not-found.exception';
import {
  ProvisionRestaurantOwnerCommand,
  ProvisionRestaurantOwnerResult,
} from '../dto/provision-restaurant-owner.command';
import { RegistrationConsentRequiredException } from '../exceptions/registration-consent-required.exception';
import { InvalidRegistrationInputException } from '../exceptions/invalid-registration-input.exception';
import { resolveOrganizationSlug } from '../utils/organization-slug.util';
import {
  PASSWORD_HASHER,
  SYSTEM_CONFIGURATION,
  USER_CONSENT_REPOSITORY,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';

/** ADR-027 §11/D7 - the seeded `SubscriptionPlan.slug` provisioned automatically for every new Organization, unless overridden by `SystemConfiguration.defaultSubscriptionPlanSlug`. */
const DEFAULT_SUBSCRIPTION_PLAN_SLUG = 'default';

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
 *
 * Phase 12 (Subscriptions, ADR-027 §11, 2026-07-28): this is the sole
 * Organization-creation code path in the codebase (the historical public
 * `RegisterOrganizationOwnerUseCase` was retired by ADR-022), so it is where
 * the default Subscription/SubscriptionUsage are provisioned - in the same
 * transaction as User/Organization/OrganizationMember/UserConsent, so no
 * Organization can ever exist without exactly one Subscription (D7). No
 * Restaurant exists yet at Organization-creation time, so no RestaurantUsage
 * row is created here - that happens in `CreateRestaurantUseCase`.
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
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepository: SubscriptionRepository,
    @Inject(SUBSCRIPTION_PLAN_REPOSITORY)
    private readonly subscriptionPlanRepository: SubscriptionPlanRepository,
    @Inject(SUBSCRIPTION_USAGE_REPOSITORY)
    private readonly subscriptionUsageRepository: SubscriptionUsageRepository,
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
      deletionRequestedAt: null,
      scheduledAnonymizationAt: null,
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

    // ADR-027 §11/D7 - resolved before the transaction (SubscriptionPlan is
    // platform-global, not tenant-scoped, so this lookup does not need
    // TenantContext bound). Fails loud (SubscriptionPlanNotFoundException)
    // rather than silently creating an Organization with no Subscription -
    // the seed script guarantees this plan exists in every real environment.
    const defaultPlanSlug = await this.systemConfiguration.getString(
      SYSTEM_CONFIG_KEYS.defaultSubscriptionPlanSlug,
      DEFAULT_SUBSCRIPTION_PLAN_SLUG,
    );
    const defaultPlan = await this.subscriptionPlanRepository.findBySlug(defaultPlanSlug);
    if (defaultPlan === null) {
      throw new SubscriptionPlanNotFoundException();
    }

    const subscription = Subscription.create({
      id: this.idGenerator.generate(),
      organizationId: organizationId.value,
      subscriptionPlanId: defaultPlan.planId.value,
      startsAt: now,
      now,
    });
    const subscriptionUsage = SubscriptionUsage.create({
      id: this.idGenerator.generate(),
      organizationId: organizationId.value,
      now,
    });

    // Same tenant-bootstrap reasoning as RegisterOrganizationOwnerUseCase:
    // this is the operation that CREATES the Organization, so no JWT/
    // interceptor-bound TenantContext can exist yet - organizationId here is
    // this use case's own server-generated id, never client input. The
    // Subscription/SubscriptionUsage writes run inside the same transaction
    // as User/Organization/OrganizationMember/UserConsent (D7) - an
    // Organization can never exist without exactly one Subscription.
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
          await this.subscriptionRepository.create(subscription);
          await this.subscriptionUsageRepository.create(subscriptionUsage);
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
