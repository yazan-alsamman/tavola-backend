import { Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { OrganizationsModule } from '@modules/organizations/organizations.module';
import { LoginUseCase } from './application/use-cases/login.use-case';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case';
import { LogoutCurrentSessionUseCase } from './application/use-cases/logout-current-session.use-case';
import { LogoutAllDevicesUseCase } from './application/use-cases/logout-all-devices.use-case';
import { ListActiveSessionsUseCase } from './application/use-cases/list-active-sessions.use-case';
import { RevokeSessionUseCase } from './application/use-cases/revoke-session.use-case';
import { ForgotPasswordUseCase } from './application/use-cases/forgot-password.use-case';
import { ResetPasswordUseCase } from './application/use-cases/reset-password.use-case';
import { ChangePasswordUseCase } from './application/use-cases/change-password.use-case';
import { StartCustomerRegistrationUseCase } from './application/use-cases/start-customer-registration.use-case';
import { ResendCustomerRegistrationUseCase } from './application/use-cases/resend-customer-registration.use-case';
import { VerifyCustomerRegistrationUseCase } from './application/use-cases/verify-customer-registration.use-case';
import { CompleteCustomerRegistrationUseCase } from './application/use-cases/complete-customer-registration.use-case';
import { CustomerLoginUseCase } from './application/use-cases/customer-login.use-case';
import { StartCustomerPasswordResetUseCase } from './application/use-cases/start-customer-password-reset.use-case';
import { ResendCustomerPasswordResetUseCase } from './application/use-cases/resend-customer-password-reset.use-case';
import { VerifyCustomerPasswordResetUseCase } from './application/use-cases/verify-customer-password-reset.use-case';
import { CompleteCustomerPasswordResetUseCase } from './application/use-cases/complete-customer-password-reset.use-case';
import { ProvisionRestaurantOwnerUseCase } from './application/use-cases/provision-restaurant-owner.use-case';
import { AuthController } from './presentation/controllers/auth.controller';
import { CustomerAuthController } from './presentation/controllers/customer-auth.controller';
import { JwtAuthGuard } from './presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from './presentation/guards/session-version.guard';
import { RateLimitGuard } from './presentation/guards/rate-limit.guard';
import { Argon2PasswordHasher } from './infrastructure/security/argon2-password-hasher';
import { Sha256OpaqueTokenService } from './infrastructure/security/sha256-opaque-token.service';
import { JwtTokenService } from './infrastructure/security/jwt-token.service';
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user.repository';
import { PrismaPendingCustomerRegistrationRepository } from './infrastructure/persistence/prisma-pending-customer-registration.repository';
import { PrismaCustomerPasswordResetRepository } from './infrastructure/persistence/prisma-customer-password-reset.repository';
import { CryptoOtpService } from './infrastructure/security/otp.service';
import { LightOtpVerificationMessagingAdapter } from './infrastructure/messaging/lightotp-verification-messaging.adapter';
import { PrismaDeviceSessionRepository } from './infrastructure/persistence/prisma-device-session.repository';
import { PrismaTokenFamilyRepository } from './infrastructure/persistence/prisma-token-family.repository';
import { PrismaLoginAttemptRepository } from './infrastructure/persistence/prisma-login-attempt.repository';
import { PrismaPasswordResetRepository } from './infrastructure/persistence/prisma-password-reset.repository';
import { PrismaPasswordHistoryRepository } from './infrastructure/persistence/prisma-password-history.repository';
import { PrismaSystemConfiguration } from './infrastructure/persistence/prisma-system-configuration';
import { PrismaLoginOrganizationReader } from './infrastructure/persistence/prisma-login-organization-reader';
import { PrismaUserConsentRepository } from './infrastructure/persistence/prisma-user-consent.repository';
import { PrismaUnitOfWork } from './infrastructure/persistence/prisma-unit-of-work';
import { SystemClock } from './infrastructure/clock/system-clock';
import { UuidIdGenerator } from './infrastructure/id/uuid-id-generator';
import { LoggingEventPublisher } from './infrastructure/events/logging-event-publisher';
import { AuditingEventPublisher } from './infrastructure/events/auditing-event-publisher';
import { NestAuthTokenTtl } from './infrastructure/config/nest-auth-token-ttl';
import { NestAuthRefreshPolicy } from './infrastructure/config/nest-auth-refresh-policy';
import { NestAuthRateLimitPolicy } from './infrastructure/config/nest-auth-rate-limit-policy';
import { RedisSlidingWindowRateLimiter } from './infrastructure/redis/redis-sliding-window-rate-limiter';
import { AUTH_TOKEN_TTL } from './application/ports/auth-token-ttl.port';
import { AUTH_RATE_LIMIT_POLICY } from './application/ports/auth-rate-limit-policy.port';
import { LOGIN_ORGANIZATION_READER } from './application/ports/login-organization-reader.port';
import { VERIFICATION_MESSAGING } from './application/ports/verification-messaging.port';
import {
  AUTH_REFRESH_POLICY,
  CLOCK,
  DEVICE_SESSION_REPOSITORY,
  ID_GENERATOR,
  LOGIN_ATTEMPT_REPOSITORY,
  OPAQUE_TOKEN_SERVICE,
  OTP_SERVICE,
  PASSWORD_HASHER,
  PASSWORD_HISTORY_REPOSITORY,
  PASSWORD_RESET_REPOSITORY,
  PENDING_CUSTOMER_REGISTRATION_REPOSITORY,
  CUSTOMER_PASSWORD_RESET_REPOSITORY,
  RATE_LIMITER,
  SYSTEM_CONFIGURATION,
  TOKEN_FAMILY_REPOSITORY,
  TOKEN_SERVICE,
  UNIT_OF_WORK,
  USER_CONSENT_REPOSITORY,
  USER_REPOSITORY,
} from './domain/tokens/authentication.tokens';

/**
 * ADR-022 (Phase 2.23 closure): `EmailVerificationRepository`/
 * `PrismaEmailVerificationRepository`/`EMAIL_VERIFICATION_REPOSITORY` and
 * `RegisterOrganizationOwnerUseCase`/`VerifyEmailUseCase` are RETIRED - no
 * surviving actor requires them. See `DECISIONS.md` ADR-022.
 *
 * Phase 8 (WebSocket, architecture frozen 2026-07-24): this module no longer
 * binds the `EVENT_PUBLISHER` token itself. `RealtimeModule` (`@Global()`)
 * now owns that binding - `RealtimeEventPublisher` wrapping this module's own
 * `AuditingEventPublisher` (still built and exported here unchanged) as the
 * outermost decorator. Every existing `@Inject(EVENT_PUBLISHER)` call site
 * across the codebase is unaffected: `RealtimeModule` being global makes the
 * token ambiently available without any feature module adding it to its own
 * `imports`, which also avoids a circular dependency this module would
 * otherwise have on `RealtimeModule` (which itself needs Reservations/
 * Branches/Restaurants repositories that transitively import this module).
 */
@Module({
  imports: [PrismaModule, AuthorizationModule, OrganizationsModule],
  controllers: [AuthController, CustomerAuthController],
  providers: [
    LoginUseCase,
    RefreshSessionUseCase,
    LogoutCurrentSessionUseCase,
    LogoutAllDevicesUseCase,
    ListActiveSessionsUseCase,
    RevokeSessionUseCase,
    ForgotPasswordUseCase,
    ResetPasswordUseCase,
    ChangePasswordUseCase,
    StartCustomerRegistrationUseCase,
    ResendCustomerRegistrationUseCase,
    VerifyCustomerRegistrationUseCase,
    CompleteCustomerRegistrationUseCase,
    CustomerLoginUseCase,
    StartCustomerPasswordResetUseCase,
    ResendCustomerPasswordResetUseCase,
    VerifyCustomerPasswordResetUseCase,
    CompleteCustomerPasswordResetUseCase,
    ProvisionRestaurantOwnerUseCase,
    JwtAuthGuard,
    SessionVersionGuard,
    RateLimitGuard,
    Argon2PasswordHasher,
    Sha256OpaqueTokenService,
    JwtTokenService,
    NestAuthTokenTtl,
    NestAuthRefreshPolicy,
    NestAuthRateLimitPolicy,
    RedisSlidingWindowRateLimiter,
    PrismaUserRepository,
    PrismaPendingCustomerRegistrationRepository,
    PrismaCustomerPasswordResetRepository,
    CryptoOtpService,
    LightOtpVerificationMessagingAdapter,
    PrismaDeviceSessionRepository,
    PrismaTokenFamilyRepository,
    PrismaLoginAttemptRepository,
    PrismaPasswordResetRepository,
    PrismaPasswordHistoryRepository,
    PrismaSystemConfiguration,
    PrismaLoginOrganizationReader,
    PrismaUserConsentRepository,
    PrismaUnitOfWork,
    SystemClock,
    UuidIdGenerator,
    LoggingEventPublisher,
    AuditingEventPublisher,
    { provide: PASSWORD_HASHER, useExisting: Argon2PasswordHasher },
    { provide: OPAQUE_TOKEN_SERVICE, useExisting: Sha256OpaqueTokenService },
    { provide: TOKEN_SERVICE, useExisting: JwtTokenService },
    { provide: USER_REPOSITORY, useExisting: PrismaUserRepository },
    {
      provide: PENDING_CUSTOMER_REGISTRATION_REPOSITORY,
      useExisting: PrismaPendingCustomerRegistrationRepository,
    },
    {
      provide: CUSTOMER_PASSWORD_RESET_REPOSITORY,
      useExisting: PrismaCustomerPasswordResetRepository,
    },
    { provide: OTP_SERVICE, useExisting: CryptoOtpService },
    { provide: VERIFICATION_MESSAGING, useExisting: LightOtpVerificationMessagingAdapter },
    {
      provide: PASSWORD_RESET_REPOSITORY,
      useExisting: PrismaPasswordResetRepository,
    },
    {
      provide: PASSWORD_HISTORY_REPOSITORY,
      useExisting: PrismaPasswordHistoryRepository,
    },
    {
      provide: DEVICE_SESSION_REPOSITORY,
      useExisting: PrismaDeviceSessionRepository,
    },
    {
      provide: TOKEN_FAMILY_REPOSITORY,
      useExisting: PrismaTokenFamilyRepository,
    },
    {
      provide: LOGIN_ATTEMPT_REPOSITORY,
      useExisting: PrismaLoginAttemptRepository,
    },
    { provide: SYSTEM_CONFIGURATION, useExisting: PrismaSystemConfiguration },
    { provide: UNIT_OF_WORK, useExisting: PrismaUnitOfWork },
    { provide: CLOCK, useExisting: SystemClock },
    { provide: ID_GENERATOR, useExisting: UuidIdGenerator },
    { provide: AUTH_TOKEN_TTL, useExisting: NestAuthTokenTtl },
    { provide: AUTH_REFRESH_POLICY, useExisting: NestAuthRefreshPolicy },
    { provide: AUTH_RATE_LIMIT_POLICY, useExisting: NestAuthRateLimitPolicy },
    { provide: RATE_LIMITER, useExisting: RedisSlidingWindowRateLimiter },
    { provide: LOGIN_ORGANIZATION_READER, useExisting: PrismaLoginOrganizationReader },
    { provide: USER_CONSENT_REPOSITORY, useExisting: PrismaUserConsentRepository },
  ],
  exports: [
    PASSWORD_HASHER,
    OPAQUE_TOKEN_SERVICE,
    TOKEN_SERVICE,
    USER_REPOSITORY,
    PASSWORD_RESET_REPOSITORY,
    PASSWORD_HISTORY_REPOSITORY,
    DEVICE_SESSION_REPOSITORY,
    TOKEN_FAMILY_REPOSITORY,
    LOGIN_ATTEMPT_REPOSITORY,
    SYSTEM_CONFIGURATION,
    UNIT_OF_WORK,
    CLOCK,
    ID_GENERATOR,
    AUTH_TOKEN_TTL,
    AUTH_REFRESH_POLICY,
    AUTH_RATE_LIMIT_POLICY,
    RATE_LIMITER,
    LOGIN_ORGANIZATION_READER,
    USER_CONSENT_REPOSITORY,
    JwtAuthGuard,
    SessionVersionGuard,
    RateLimitGuard,
    // Phase 8 (WebSocket): AuditingEventPublisher (the class itself, not just
    // the EVENT_PUBLISHER token it used to be bound to here) is exported so
    // RealtimeModule can @Inject(AuditingEventPublisher) it directly as the
    // inner publisher RealtimeEventPublisher wraps - see RealtimeModule's own
    // doc comment for why EVENT_PUBLISHER's binding moved out of this module.
    AuditingEventPublisher,
    LoginUseCase,
    RefreshSessionUseCase,
    LogoutCurrentSessionUseCase,
    LogoutAllDevicesUseCase,
    ListActiveSessionsUseCase,
    RevokeSessionUseCase,
    ForgotPasswordUseCase,
    ResetPasswordUseCase,
    ChangePasswordUseCase,
    ProvisionRestaurantOwnerUseCase,
  ],
})
export class AuthenticationModule {}
