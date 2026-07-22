import { Injectable, Inject } from '@nestjs/common';
import { Email } from '@shared/domain/value-objects/email.vo';
import { Password } from '@shared/domain/value-objects/password.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { ClockPort } from '@shared/application/ports/clock.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import {
  SYSTEM_CONFIG_KEYS,
  SystemConfigurationPort,
} from '@shared/application/ports/system-configuration.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { DeviceSession } from '../../domain/entities/device-session.entity';
import { TokenFamily } from '../../domain/entities/token-family.entity';
import { DeviceType, UserStatus } from '../../domain/enums/authentication.enums';
import { AccountLockedEvent, UserLoggedInEvent } from '../../domain/events/authentication.events';
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
  CLOCK,
  DEVICE_SESSION_REPOSITORY,
  EVENT_PUBLISHER,
  ID_GENERATOR,
  LOGIN_ATTEMPT_REPOSITORY,
  OPAQUE_TOKEN_SERVICE,
  PASSWORD_HASHER,
  SYSTEM_CONFIGURATION,
  TOKEN_FAMILY_REPOSITORY,
  TOKEN_SERVICE,
  UNIT_OF_WORK,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';
import { AuthTokenTtlPort, AUTH_TOKEN_TTL } from '../ports/auth-token-ttl.port';
import {
  LoginOrganizationReaderPort,
  LOGIN_ORGANIZATION_READER,
} from '../ports/login-organization-reader.port';
import {
  EmployeeAccessResolverPort,
  EMPLOYEE_ACCESS_RESOLVER,
} from '../ports/employee-access-resolver.port';
import { EmployeeRepository } from '@modules/authorization/domain/repositories/authorization.repositories';
import { EMPLOYEE_REPOSITORY } from '@modules/authorization/application/tokens/authorization.tokens';
import { LoginCommand } from '../dto/login.command';
import { LoginResult } from '../dto/login.result';
import {
  AccountLockedException,
  AccountSuspendedException,
  EmailNotVerifiedException,
  InvalidCredentialsException,
} from '../exceptions/login.exceptions';
import { TooManySessionsException } from '../exceptions/too-many-sessions.exception';
import { TIMING_SAFE_DUMMY_PASSWORD_HASH } from '../../domain/services/timing-safe-dummy';

@Injectable()
export class LoginUseCase {
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
    @Inject(LOGIN_ORGANIZATION_READER)
    private readonly loginOrganizationReader: LoginOrganizationReaderPort,
    @Inject(EMPLOYEE_ACCESS_RESOLVER)
    private readonly employeeAccessResolver: EmployeeAccessResolverPort,
    @Inject(EMPLOYEE_REPOSITORY) private readonly employeeRepository: EmployeeRepository,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: LoginCommand): Promise<LoginResult> {
    const now = this.clock.now();
    const email = Email.create(command.email);
    const password = Password.create(command.password);
    const ipAddress = command.ipAddress?.trim() || 'unknown';

    const user = await this.userRepository.findByEmail(email);

    if (user !== null) {
      try {
        user.canLogin(now);
      } catch (error) {
        await this.auditLogWriter.record({
          actorId: user.userId.value,
          actorType: 'User',
          action:
            error instanceof AccountLockedException
              ? 'auth.login.blocked_locked'
              : error instanceof AccountSuspendedException
                ? 'auth.login.blocked_suspended'
                : error instanceof EmailNotVerifiedException
                  ? 'auth.login.blocked_unverified'
                  : 'auth.login.failed',
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

        // AccountLocked is EVENTS.md's own documented security event
        // (producer: LoginUseCase, trigger: "Failed login threshold
        // exceeded") - Phase 2.18 stood in with a direct audit write only
        // because no domain event existed yet to carry it. Now that
        // AccountLockedEvent exists, AuditingEventPublisher produces the
        // exact same 'auth.account.locked' audit row from this publish, so
        // the direct write is retired (Phase 2.19's "remove duplicated
        // direct audit writes whenever a proper Domain Event now exists").
        // Only the lock *transition* is published, not every already-locked
        // attempt.
        if (user.status !== UserStatus.Locked && updatedUser.status === UserStatus.Locked) {
          await this.eventPublisher.publish(
            new AccountLockedEvent(
              this.idGenerator.generate(),
              {
                userId: user.userId.value,
                lockedUntil: updatedUser.lockedUntil!,
                failedAttempts: updatedUser.failedLoginCount,
              },
              now,
              command.correlationId,
            ),
          );
        }
      }

      await this.recordLoginAttempt({
        identifier: email.value,
        ipAddress,
        success: false,
        failureReason: 'invalid_credentials',
        now,
      });

      await this.auditLogWriter.record({
        actorId: user?.userId.value ?? null,
        actorType: 'User',
        action: 'auth.login.failed',
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

    // Phase 7.0 (Employee Management) first-login linking
    // (AUTHENTICATION_ARCHITECTURE.md §1.2: "Employee invite: Pre-created
    // Employee linked on first login") - must complete before
    // `employeeAccessResolver.resolveForUserId` below, which only resolves
    // claims for an already-linked (`userId` set), `Active` Employee row.
    // Never done in `RefreshSessionUseCase` (TASKS.md Phase 7.0 decision note
    // item 5) - linking is a one-time event that belongs at authentication,
    // not silently during a token refresh.
    const pendingInvites = await this.employeeRepository.findUnlinkedInvitedByEmail(email.value);
    for (const pendingEmployee of pendingInvites) {
      await this.employeeRepository.save(pendingEmployee.activateAndLink(user.userId.value, now));
    }

    const [organization, employeeAccess] = await Promise.all([
      this.loginOrganizationReader.findByUserId(user.userId),
      this.employeeAccessResolver.resolveForUserId(user.userId),
    ]);

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
      organization,
      employeeAccess,
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

    await this.recordLoginAttempt({
      identifier: email.value,
      ipAddress,
      success: true,
      failureReason: null,
      now,
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
        // Non-null assertions are safe here: this use case only ever
        // reaches this line for a user resolved via `findByEmail` above
        // (ADR-022, Phase 2.23 — Customer rows have no email and never
        // authenticate through this email/password path).
        email: props.email!,
        firstName: props.firstName!,
        lastName: props.lastName!,
        status: props.status,
        emailVerified: props.emailVerified,
      },
      organization,
      sessionId,
      sessionVersion: loggedInUser.sessionVersion,
      permissionsVersion: resolvedClaims.permissionsVersion,
      actorType: resolvedClaims.actorType,
      requiresPasswordChange: false,
    };
  }

  private async recordLoginAttempt(input: {
    identifier: string;
    ipAddress: string;
    success: boolean;
    failureReason: string | null;
    now: Date;
  }): Promise<void> {
    await this.loginAttemptRepository.save({
      id: this.idGenerator.generate(),
      identifier: input.identifier,
      ipAddress: input.ipAddress,
      success: input.success,
      failureReason: input.failureReason,
      createdAt: input.now,
    });
  }
}
