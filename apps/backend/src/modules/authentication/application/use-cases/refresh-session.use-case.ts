import { Injectable, Inject } from '@nestjs/common';
import { RefreshTokenHash } from '@shared/domain/value-objects/refresh-token-hash.vo';
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
import { DeviceSession } from '../../domain/entities/device-session.entity';
import { SessionRevokeReason } from '../../domain/enums/authentication.enums';
import {
  SessionFamilyRevokedEvent,
  SessionRefreshedEvent,
  SessionRevokedEvent,
  TokenFamilyCompromisedEvent,
  TokenReplayDetectedEvent,
} from '../../domain/events/authentication.events';
import {
  DeviceSessionRepository,
  TokenFamilyRepository,
  UserRepository,
} from '../../domain/repositories/authentication.repositories';
import { OpaqueTokenService } from '../../domain/services/opaque-token.port';
import { SessionPolicy } from '../../domain/services/authentication-policies';
import { TokenService } from '../../domain/services/token-service.port';
import { AccessTokenClaimsBuilder } from '../services/access-token-claims-builder';
import { AUTH_TOKEN_TTL, AuthTokenTtlPort } from '../ports/auth-token-ttl.port';
import { AuthRefreshPolicyPort } from '../ports/auth-refresh-policy.port';
import {
  LoginOrganizationReaderPort,
  LOGIN_ORGANIZATION_READER,
} from '../ports/login-organization-reader.port';
import {
  EmployeeAccessResolverPort,
  EMPLOYEE_ACCESS_RESOLVER,
} from '../ports/employee-access-resolver.port';
import {
  AUTH_REFRESH_POLICY,
  DEVICE_SESSION_REPOSITORY,
  OPAQUE_TOKEN_SERVICE,
  SYSTEM_CONFIGURATION,
  TOKEN_FAMILY_REPOSITORY,
  TOKEN_SERVICE,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';
import { RefreshSessionCommand } from '../dto/refresh-session.command';
import { RefreshSessionResult } from '../dto/refresh-session.result';
import { InvalidRefreshTokenException } from '../exceptions/invalid-refresh-token.exception';

@Injectable()
export class RefreshSessionUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(DEVICE_SESSION_REPOSITORY)
    private readonly deviceSessionRepository: DeviceSessionRepository,
    @Inject(TOKEN_FAMILY_REPOSITORY)
    private readonly tokenFamilyRepository: TokenFamilyRepository,
    @Inject(OPAQUE_TOKEN_SERVICE) private readonly opaqueTokenService: OpaqueTokenService,
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
    @Inject(AUTH_TOKEN_TTL) private readonly authTokenTtl: AuthTokenTtlPort,
    @Inject(AUTH_REFRESH_POLICY) private readonly authRefreshPolicy: AuthRefreshPolicyPort,
    @Inject(LOGIN_ORGANIZATION_READER)
    private readonly loginOrganizationReader: LoginOrganizationReaderPort,
    @Inject(EMPLOYEE_ACCESS_RESOLVER)
    private readonly employeeAccessResolver: EmployeeAccessResolverPort,
  ) {}

  async execute(command: RefreshSessionCommand): Promise<RefreshSessionResult> {
    const refreshToken = command.refreshToken?.trim();
    if (!refreshToken) {
      throw new InvalidRefreshTokenException();
    }

    const now = this.clock.now();
    const presentedHash = this.opaqueTokenService.hash(refreshToken);
    const hashVo = RefreshTokenHash.create(presentedHash);

    const activeSession = await this.deviceSessionRepository.findByRefreshTokenHash(hashVo);
    if (activeSession !== null) {
      return this.refreshWithCurrentToken(activeSession, presentedHash, command, now);
    }

    const replaySession = await this.deviceSessionRepository.findByPreviousRefreshTokenHash(hashVo);
    if (replaySession !== null) {
      await this.handleSupersededToken(replaySession, command, now);
    }

    throw new InvalidRefreshTokenException();
  }

  private async refreshWithCurrentToken(
    session: DeviceSession,
    presentedHash: string,
    command: RefreshSessionCommand,
    now: Date,
  ): Promise<RefreshSessionResult> {
    await this.assertRefreshPreconditions(session, now);

    const refreshTokenTtlDays = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.refreshTokenTtlDays,
      30,
    );
    const newRefreshToken = this.opaqueTokenService.generate();
    const newHash = this.opaqueTokenService.hash(newRefreshToken);
    const slidingExpiresAt = SessionPolicy.calculateRefreshExpiry(now, refreshTokenTtlDays);

    const user = (await this.userRepository.findById(session.userId))!;

    const [organization, employeeAccess] = await Promise.all([
      this.loginOrganizationReader.findByUserId(user.userId),
      this.employeeAccessResolver.resolveForUserId(user.userId),
    ]);

    const resolvedClaims = AccessTokenClaimsBuilder.build({
      userId: user.userId.value,
      sessionId: session.sessionId.value,
      sessionVersion: user.sessionVersion,
      tokenFamilyId: session.tokenFamilyId.value,
      userPermissionsVersion: user.permissionsVersion,
      organization,
      employeeAccess,
    });

    const rotation = await this.unitOfWork.execute(async () =>
      this.deviceSessionRepository.rotateRefreshTokenIfHashMatches({
        presentedHash,
        newHash,
        now,
        expiresAt: slidingExpiresAt,
        permissionsVersion: resolvedClaims.permissionsVersion,
      }),
    );

    if (rotation.status === 'hash_mismatch') {
      throw new InvalidRefreshTokenException();
    }

    const refreshedSession = (await this.deviceSessionRepository.findById(session.sessionId))!;

    const accessTokenExpiresAt = new Date(
      now.getTime() + this.authTokenTtl.accessTokenTtlSeconds * 1000,
    );

    const accessToken = this.tokenService.signAccessToken(resolvedClaims.claims);

    await this.eventPublisher.publish(
      new SessionRefreshedEvent(
        this.idGenerator.generate(),
        {
          userId: user.userId.value,
          sessionId: refreshedSession.sessionId.value,
          tokenFamilyId: refreshedSession.tokenFamilyId.value,
        },
        now,
        command.correlationId,
      ),
    );

    return {
      userId: user.userId.value,
      accessToken,
      refreshToken: newRefreshToken,
      tokenType: 'Bearer',
      accessTokenExpiresAt,
      refreshTokenExpiresAt: slidingExpiresAt,
      sessionId: refreshedSession.sessionId.value,
      sessionVersion: user.sessionVersion,
      permissionsVersion: resolvedClaims.permissionsVersion,
      actorType: resolvedClaims.actorType,
      issuedAt: now,
      serverTime: now,
    };
  }

  private async assertRefreshPreconditions(session: DeviceSession, now: Date): Promise<void> {
    const family = await this.tokenFamilyRepository.findById(session.tokenFamilyId);
    if (family === null) {
      throw new InvalidRefreshTokenException();
    }

    family.assertUsable();
    session.assertActiveForRefresh(now);

    const user = await this.userRepository.findById(session.userId);
    if (user === null) {
      throw new InvalidRefreshTokenException();
    }

    user.canLogin(now);

    if (
      SessionPolicy.isSessionVersionStale(session.toProps().sessionVersion, user.sessionVersion)
    ) {
      throw new InvalidRefreshTokenException();
    }
  }

  private async handleSupersededToken(
    session: DeviceSession,
    command: RefreshSessionCommand,
    now: Date,
  ): Promise<never> {
    const lastUsedAt = session.toProps().lastUsedAt;
    if (
      lastUsedAt !== null &&
      now.getTime() - lastUsedAt.getTime() <= this.authRefreshPolicy.refreshConcurrentGraceMs
    ) {
      throw new InvalidRefreshTokenException();
    }

    const userId = session.userId.value;
    const sessionId = session.sessionId.value;
    const tokenFamilyId = session.tokenFamilyId.value;

    await this.unitOfWork.execute(async () => {
      await this.tokenFamilyRepository.markCompromisedIfActive(session.tokenFamilyId, now);
      await this.deviceSessionRepository.revokeAllByTokenFamilyId(
        session.tokenFamilyId,
        now,
        SessionRevokeReason.ReuseDetected,
      );
    });

    await this.eventPublisher.publish(
      new TokenReplayDetectedEvent(
        this.idGenerator.generate(),
        {
          userId,
          sessionId,
          tokenFamilyId,
          ipAddress: command.ipAddress,
        },
        now,
        command.correlationId,
      ),
    );

    await this.eventPublisher.publish(
      new TokenFamilyCompromisedEvent(
        this.idGenerator.generate(),
        { userId, tokenFamilyId },
        now,
        command.correlationId,
      ),
    );

    await this.eventPublisher.publish(
      new SessionFamilyRevokedEvent(
        this.idGenerator.generate(),
        {
          userId,
          tokenFamilyId,
          reason: SessionRevokeReason.ReuseDetected,
        },
        now,
        command.correlationId,
      ),
    );

    await this.eventPublisher.publish(
      new SessionRevokedEvent(
        this.idGenerator.generate(),
        {
          userId,
          sessionId,
          reason: SessionRevokeReason.ReuseDetected,
        },
        now,
        command.correlationId,
      ),
    );

    throw new InvalidRefreshTokenException();
  }
}
