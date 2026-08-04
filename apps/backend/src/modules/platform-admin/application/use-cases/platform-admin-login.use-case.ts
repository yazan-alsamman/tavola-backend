import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformAdminAuthConfig } from '@config/platform-admin-auth.config';
import { Email } from '@shared/domain/value-objects/email.vo';
import { Password } from '@shared/domain/value-objects/password.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { LoginAttemptRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { PasswordHasher } from '@modules/authentication/domain/services/password-hasher.port';
import { LoginPolicy } from '@modules/authentication/domain/services/login-policy';
import { TIMING_SAFE_DUMMY_PASSWORD_HASH } from '@modules/authentication/domain/services/timing-safe-dummy';
import {
  USER_REPOSITORY,
  LOGIN_ATTEMPT_REPOSITORY,
  PASSWORD_HASHER,
  SYSTEM_CONFIGURATION,
} from '@modules/authentication/domain/tokens/authentication.tokens';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  SYSTEM_CONFIG_KEYS,
  SystemConfigurationPort,
} from '@shared/application/ports/system-configuration.port';
import {
  PlatformAdminRepository,
  PLATFORM_ADMIN_REPOSITORY,
} from '../../domain/repositories/platform-admin.repository';
import {
  PlatformAdminTokenService,
  PLATFORM_ADMIN_TOKEN_SERVICE,
} from '../../domain/services/platform-admin-token.port';
import { InvalidPlatformAdminCredentialsException } from '../../domain/exceptions/invalid-platform-admin-credentials.exception';
import {
  PlatformAdminLoginCommand,
  PlatformAdminLoginResult,
} from '../dto/platform-admin-login.command';

/**
 * ADR-022 §"Platform Admin Authentication" (Phase 2.23 closure, approved
 * decision): a Platform Admin is a `User` row with an active `PlatformAdmin`
 * record (schema.prisma's existing model - no separate credential store is
 * introduced). Credentials are validated exactly like `LoginUseCase`
 * (Argon2id, `LoginAttemptRepository`, failed-attempt lockout via the same
 * `LoginPolicy`), but the issued token comes from the completely separate
 * `PlatformAdminTokenService` - never `TokenService`. Enumeration-resistant:
 * unknown email, wrong password, and "real account but not an active
 * Platform Admin" all collapse to the same
 * `InvalidPlatformAdminCredentialsException`.
 *
 * There is deliberately no corresponding "register Platform Admin"
 * endpoint - accounts are expected to be provisioned operationally
 * (ADR-022: "Do NOT introduce public Platform Admin registration").
 */
@Injectable()
export class PlatformAdminLoginUseCase {
  private readonly tokenTtlSeconds: number;

  constructor(
    private readonly configService: ConfigService,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(PLATFORM_ADMIN_REPOSITORY)
    private readonly platformAdminRepository: PlatformAdminRepository,
    @Inject(LOGIN_ATTEMPT_REPOSITORY)
    private readonly loginAttemptRepository: LoginAttemptRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(PLATFORM_ADMIN_TOKEN_SERVICE)
    private readonly platformAdminTokenService: PlatformAdminTokenService,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {
    const config = this.configService.get<PlatformAdminAuthConfig>('platformAdminAuth', {
      infer: true,
    });
    this.tokenTtlSeconds = config?.jwtExpirySeconds ?? 900;
  }

  async execute(command: PlatformAdminLoginCommand): Promise<PlatformAdminLoginResult> {
    const now = this.clock.now();
    const email = Email.create(command.email);
    const password = Password.create(command.password);
    const ipAddress = command.ipAddress?.trim() || 'unknown';

    const user = await this.userRepository.findByEmail(email);
    const authContext =
      user !== null
        ? await this.platformAdminRepository.findActiveAdminContext(user.userId.value)
        : null;

    const passwordMatches = await this.passwordHasher.verify(
      password,
      PasswordHash.create(user?.passwordHash.value ?? TIMING_SAFE_DUMMY_PASSWORD_HASH),
    );

    if (user === null || authContext === null || !passwordMatches) {
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
        identifier: email.value,
        ipAddress,
        success: false,
        failureReason: 'invalid_platform_admin_credentials',
        createdAt: now,
      });

      await this.auditLogWriter.record({
        actorId: user?.userId.value ?? null,
        actorType: 'User',
        action: 'platform_admin.login.failed',
        targetType: user ? 'User' : null,
        targetId: user?.userId.value ?? null,
        organizationId: null,
        correlationId: null,
        ipAddress,
        occurredAt: now,
      });

      throw new InvalidPlatformAdminCredentialsException();
    }

    try {
      user.canLogin(now);
    } catch {
      throw new InvalidPlatformAdminCredentialsException();
    }

    await this.loginAttemptRepository.save({
      id: this.idGenerator.generate(),
      identifier: email.value,
      ipAddress,
      success: true,
      failureReason: null,
      createdAt: now,
    });

    await this.auditLogWriter.record({
      actorId: user.userId.value,
      actorType: 'User',
      action: 'platform_admin.login.success',
      targetType: 'User',
      targetId: user.userId.value,
      organizationId: null,
      correlationId: null,
      ipAddress,
      occurredAt: now,
    });

    // Non-null: the failure branch above already returned for a null authContext.
    const accessToken = this.platformAdminTokenService.signAccessToken({
      sub: user.userId.value,
      role: authContext.role,
    });

    return {
      accessToken,
      accessTokenExpiresAt: new Date(now.getTime() + this.tokenTtlSeconds * 1000),
    };
  }
}
