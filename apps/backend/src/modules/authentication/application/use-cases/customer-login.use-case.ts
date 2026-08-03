import { Injectable, Inject } from '@nestjs/common';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { Password } from '@shared/domain/value-objects/password.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
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
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { DeviceSession } from '../../domain/entities/device-session.entity';
import { TokenFamily } from '../../domain/entities/token-family.entity';
import { DeviceType } from '../../domain/enums/authentication.enums';
import { UserLoggedInEvent } from '../../domain/events/authentication.events';
import {
  DeviceSessionRepository,
  LoginAttemptRepository,
  TokenFamilyRepository,
  UserRepository,
} from '../../domain/repositories/authentication.repositories';
import { LoginPolicy } from '../../domain/services/login-policy';
import { OpaqueTokenService } from '../../domain/services/opaque-token.port';
import { PasswordHasher } from '../../domain/services/password-hasher.port';
import { SessionPolicy } from '../../domain/services/authentication-policies';
import { TokenService } from '../../domain/services/token-service.port';
import { AccessTokenClaimsBuilder } from '../services/access-token-claims-builder';
import {
  LOGIN_ATTEMPT_REPOSITORY,
  OPAQUE_TOKEN_SERVICE,
  PASSWORD_HASHER,
  SYSTEM_CONFIGURATION,
  DEVICE_SESSION_REPOSITORY,
  TOKEN_FAMILY_REPOSITORY,
  TOKEN_SERVICE,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';
import { AuthTokenTtlPort, AUTH_TOKEN_TTL } from '../ports/auth-token-ttl.port';
import { CustomerLoginCommand } from '../dto/customer-login.command';
import { CustomerLoginResult } from '../dto/customer-login.result';
import {
  AccountLockedException,
  AccountSuspendedException,
  InvalidCredentialsException,
} from '../exceptions/login.exceptions';
import { TooManySessionsException } from '../exceptions/too-many-sessions.exception';
import { TIMING_SAFE_DUMMY_PASSWORD_HASH } from '../../domain/services/timing-safe-dummy';

/**
 * ADR-022 §"Customer Login" / Decision #10: phone + password, a fully
 * separate use case/contract from the Owner/staff `LoginUseCase` - not a
 * discriminated-union DTO. Every ADR-016 mechanic unrelated to the
 * identifier itself is reused unchanged: Argon2id, JWT, opaque refresh
 * rotation, `DeviceSession`, `TokenFamily`, `sessionVersion`,
 * `permissionsVersion`. No Employee/OrganizationMember lookup - Customers
 * are never linked to either (Decision #11: Employee invite-linking stays
 * email-keyed, untouched).
 */
@Injectable()
export class CustomerLoginUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(DEVICE_SESSION_REPOSITORY)
    private readonly deviceSessionRepository: DeviceSessionRepository,
    @Inject(TOKEN_FAMILY_REPOSITORY)
    private readonly tokenFamilyRepository: TokenFamilyRepository,
    @Inject(LOGIN_ATTEMPT_REPOSITORY)
    private readonly loginAttemptRepository: LoginAttemptRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(OPAQUE_TOKEN_SERVICE) private readonly opaqueTokenService: OpaqueTokenService,
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
    @Inject(AUTH_TOKEN_TTL) private readonly authTokenTtl: AuthTokenTtlPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: CustomerLoginCommand): Promise<CustomerLoginResult> {
    const now = this.clock.now();
    const phone = PhoneNumber.create(command.countryCode, command.phoneNumber);
    const password = Password.create(command.password);
    const ipAddress = command.ipAddress?.trim() || 'unknown';

    const user = await this.userRepository.findByPhone(phone.value);

    if (user !== null) {
      try {
        user.canLogin(now);
      } catch (error) {
        await this.auditLogWriter.record({
          actorId: user.userId.value,
          actorType: 'User',
          action:
            error instanceof AccountLockedException
              ? 'auth.customer_login.blocked_locked'
              : error instanceof AccountSuspendedException
                ? 'auth.customer_login.blocked_suspended'
                : 'auth.customer_login.failed',
          targetType: 'User',
          targetId: user.userId.value,
          organizationId: null,
          correlationId: command.correlationId ?? null,
          ipAddress,
          occurredAt: now,
        });
        throw error;
      }
    }

    const passwordMatches = await this.passwordHasher.verify(
      password,
      PasswordHash.create(user?.passwordHash.value ?? TIMING_SAFE_DUMMY_PASSWORD_HASH),
    );

    if (user === null || !passwordMatches) {
      if (user !== null) {
        const maxFailedLoginAttempts = await this.systemConfiguration.getNumber(
          SYSTEM_CONFIG_KEYS.maxFailedLoginAttempts,
          5,
        );
        const accountLockDurationMinutes = await this.systemConfiguration.getNumber(
          SYSTEM_CONFIG_KEYS.accountLockDurationMinutes,
          30,
        );
        const updatedUser = LoginPolicy.applyFailedLogin(
          user,
          { maxFailedLoginAttempts, accountLockDurationMinutes },
          now,
        );
        await this.userRepository.save(updatedUser);
      }

      await this.loginAttemptRepository.save({
        id: this.idGenerator.generate(),
        identifier: phone.value,
        ipAddress,
        success: false,
        failureReason: 'invalid_credentials',
        createdAt: now,
      });

      await this.auditLogWriter.record({
        actorId: user?.userId.value ?? null,
        actorType: 'User',
        action: 'auth.customer_login.failed',
        targetType: user ? 'User' : null,
        targetId: user?.userId.value ?? null,
        organizationId: null,
        correlationId: command.correlationId ?? null,
        ipAddress,
        occurredAt: now,
      });

      throw new InvalidCredentialsException();
    }

    const maxActiveSessions = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.maxActiveSessionsPerUser,
      10,
    );
    const refreshTokenTtlDays = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.refreshTokenTtlDays,
      30,
    );

    const activeSessionCount = await this.deviceSessionRepository.countActiveByUserId(
      user.userId,
      now,
    );

    if (activeSessionCount >= maxActiveSessions) {
      throw new TooManySessionsException(maxActiveSessions);
    }

    const refreshToken = this.opaqueTokenService.generate();
    const refreshTokenHash = this.opaqueTokenService.hash(refreshToken);
    const tokenFamilyId = this.idGenerator.generate();
    const sessionId = this.idGenerator.generate();
    const refreshTokenExpiresAt = SessionPolicy.calculateRefreshExpiry(now, refreshTokenTtlDays);
    const accessTokenExpiresAt = new Date(
      now.getTime() + this.authTokenTtl.accessTokenTtlSeconds * 1000,
    );
    const deviceType = command.deviceType ?? DeviceType.Unknown;

    const resolvedClaims = AccessTokenClaimsBuilder.build({
      userId: user.userId.value,
      sessionId,
      sessionVersion: user.sessionVersion,
      tokenFamilyId,
      userPermissionsVersion: user.permissionsVersion,
      organization: null,
      employeeAccess: null,
    });

    const tokenFamily = TokenFamily.create({
      id: tokenFamilyId,
      userId: user.userId.value,
      compromisedAt: null,
      revokedAt: null,
      createdAt: now,
    });

    const deviceSession = DeviceSession.create({
      id: sessionId,
      userId: user.userId.value,
      tokenFamilyId,
      refreshTokenHash,
      previousRefreshTokenHash: null,
      deviceName: command.deviceName?.trim() || null,
      deviceType,
      ipAddress,
      userAgent: command.userAgent?.trim() || null,
      sessionVersion: user.sessionVersion,
      permissionsVersion: resolvedClaims.permissionsVersion,
      lastUsedAt: now,
      revokedAt: null,
      revokedReason: null,
      expiresAt: refreshTokenExpiresAt,
      createdAt: now,
    });

    const loggedInUser = await this.unitOfWork.execute(async () => {
      const updatedUser = user.recordSuccessfulLogin(now);
      await this.userRepository.save(updatedUser);
      await this.tokenFamilyRepository.save(tokenFamily);
      await this.deviceSessionRepository.save(deviceSession);
      return updatedUser;
    });

    await this.loginAttemptRepository.save({
      id: this.idGenerator.generate(),
      identifier: phone.value,
      ipAddress,
      success: true,
      failureReason: null,
      createdAt: now,
    });

    const accessToken = this.tokenService.signAccessToken(resolvedClaims.claims);
    const props = loggedInUser.toProps();

    await this.eventPublisher.publish(
      new UserLoggedInEvent(
        this.idGenerator.generate(),
        {
          userId: loggedInUser.userId.value,
          sessionId,
          tokenFamilyId,
          ipAddress,
        },
        now,
        command.correlationId,
      ),
    );

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      user: {
        userId: props.id,
        // Non-null assertions are safe: this use case only ever reaches
        // this line for a user resolved via `findByPhone` above (ADR-022 —
        // Customer accounts always have both by construction).
        username: props.username!,
        phone: props.phone!,
        status: props.status,
      },
      sessionId,
      sessionVersion: loggedInUser.sessionVersion,
      permissionsVersion: resolvedClaims.permissionsVersion,
      actorType: resolvedClaims.actorType,
    };
  }
}
