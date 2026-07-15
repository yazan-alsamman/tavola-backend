import { Injectable, Inject } from '@nestjs/common';
import { Password } from '@shared/domain/value-objects/password.vo';
import { SessionId, TokenFamilyId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort } from '@shared/application/ports/clock.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import {
  SYSTEM_CONFIG_KEYS,
  SystemConfigurationPort,
} from '@shared/application/ports/system-configuration.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import {
  PasswordChangedEvent,
  SessionRevokedEvent,
} from '../../domain/events/authentication.events';
import {
  DeviceSessionRepository,
  PasswordHistoryRepository,
  PasswordResetRepository,
  TokenFamilyRepository,
  UserRepository,
} from '../../domain/repositories/authentication.repositories';
import { AuthenticationPolicy } from '../../domain/services/authentication-policies';
import { PasswordHasher } from '../../domain/services/password-hasher.port';
import { TokenService } from '../../domain/services/token-service.port';
import {
  AccessTokenActorType,
  UserAccessTokenClaims,
} from '../../domain/services/access-token-claims';
import { AUTH_TOKEN_TTL, AuthTokenTtlPort } from '../ports/auth-token-ttl.port';
import {
  CLOCK,
  DEVICE_SESSION_REPOSITORY,
  EVENT_PUBLISHER,
  ID_GENERATOR,
  PASSWORD_HASHER,
  PASSWORD_HISTORY_REPOSITORY,
  PASSWORD_RESET_REPOSITORY,
  SYSTEM_CONFIGURATION,
  TOKEN_FAMILY_REPOSITORY,
  TOKEN_SERVICE,
  UNIT_OF_WORK,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';
import { ChangePasswordCommand } from '../dto/change-password.command';
import { ChangePasswordResult } from '../dto/change-password.result';
import { InvalidAccessTokenException } from '../exceptions/access-token.exceptions';
import { InvalidCredentialsException } from '../exceptions/login.exceptions';

@Injectable()
export class ChangePasswordUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(PASSWORD_HISTORY_REPOSITORY)
    private readonly passwordHistoryRepository: PasswordHistoryRepository,
    @Inject(PASSWORD_RESET_REPOSITORY)
    private readonly passwordResetRepository: PasswordResetRepository,
    @Inject(DEVICE_SESSION_REPOSITORY)
    private readonly deviceSessionRepository: DeviceSessionRepository,
    @Inject(TOKEN_FAMILY_REPOSITORY)
    private readonly tokenFamilyRepository: TokenFamilyRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
    @Inject(AUTH_TOKEN_TTL) private readonly authTokenTtl: AuthTokenTtlPort,
  ) {}

  async execute(command: ChangePasswordCommand): Promise<ChangePasswordResult> {
    const now = this.clock.now();
    const userId = UserId.create(command.actor.userId);
    const currentSessionId = SessionId.create(command.actor.sessionId);
    const currentTokenFamilyId = TokenFamilyId.create(command.actor.tokenFamilyId);

    const user = await this.userRepository.findById(userId);
    if (user === null) {
      throw new InvalidAccessTokenException();
    }

    user.canLogin(now);

    const currentPassword = Password.create(command.currentPassword);
    const newPassword = Password.create(command.newPassword);

    const currentPasswordMatches = await this.passwordHasher.verify(
      currentPassword,
      user.passwordHash,
    );
    if (!currentPasswordMatches) {
      throw new InvalidCredentialsException();
    }

    const passwordHistoryCount = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.passwordHistoryCount,
      5,
    );
    const history = await this.passwordHistoryRepository.findRecentByUserId(
      userId,
      passwordHistoryCount,
    );

    await AuthenticationPolicy.assertPasswordNotReused(
      newPassword,
      user.passwordHash,
      history,
      this.passwordHasher,
    );

    const newPasswordHash = await this.passwordHasher.hash(newPassword);
    const revokeReason = AuthenticationPolicy.shouldRevokeSessionsOnPasswordChange();
    const expectedCurrentHash = user.passwordHash.value;

    const transactionResult = await this.unitOfWork.execute(async () => {
      await this.passwordHistoryRepository.save({
        id: this.idGenerator.generate(),
        userId: userId.value,
        passwordHash: expectedCurrentHash,
        createdAt: now,
      });

      const updateOutcome = await this.userRepository.updatePasswordIfCurrentHashMatches({
        userId,
        expectedCurrentHash,
        newHash: newPasswordHash.value,
        at: now,
      });

      if (updateOutcome.status === 'hash_mismatch') {
        throw new InvalidCredentialsException();
      }

      await this.passwordResetRepository.invalidateActiveByUserId(userId);
      await this.passwordHistoryRepository.pruneBeyondLimit(userId, passwordHistoryCount);

      const revokedSessionIds = await this.deviceSessionRepository.revokeAllByUserIdExceptSession({
        userId,
        exceptSessionId: currentSessionId,
        at: now,
        reason: revokeReason,
      });

      await this.tokenFamilyRepository.revokeAllByUserIdExceptFamily({
        userId,
        exceptTokenFamilyId: currentTokenFamilyId,
        at: now,
      });

      const sessionUpdated = await this.deviceSessionRepository.updateSessionVersionIfActive({
        sessionId: currentSessionId,
        userId,
        sessionVersion: updateOutcome.sessionVersion,
        at: now,
      });

      if (!sessionUpdated) {
        throw new InvalidAccessTokenException();
      }

      return {
        sessionVersion: updateOutcome.sessionVersion,
        revokedSessionIds,
      };
    });

    await this.eventPublisher.publish(
      new PasswordChangedEvent(
        this.idGenerator.generate(),
        { userId: userId.value },
        now,
        command.correlationId,
      ),
    );

    for (const sessionId of transactionResult.revokedSessionIds) {
      await this.eventPublisher.publish(
        new SessionRevokedEvent(
          this.idGenerator.generate(),
          {
            userId: userId.value,
            sessionId,
            reason: revokeReason,
          },
          now,
          command.correlationId,
        ),
      );
    }

    // The current DeviceSession is preserved (see AUTHENTICATION_ARCHITECTURE.md
    // §1.8 — "Password change | Self | All sessions except current"), but the
    // sessionVersion bump above (§4.5) invalidates every previously issued
    // access token, including the one used to make this very call. Reissuing
    // an access token here — rather than requiring a separate immediate
    // /auth/refresh round trip — keeps the calling client's session usable
    // without a gap.
    const claims: UserAccessTokenClaims = {
      sub: userId.value,
      actorType: AccessTokenActorType.User,
      sessionId: currentSessionId.value,
      sessionVersion: transactionResult.sessionVersion,
      tokenFamilyId: currentTokenFamilyId.value,
    };
    const accessToken = this.tokenService.signAccessToken(claims);
    const accessTokenExpiresAt = new Date(
      now.getTime() + this.authTokenTtl.accessTokenTtlSeconds * 1000,
    );

    return {
      message: 'Password changed successfully.',
      sessionVersion: transactionResult.sessionVersion,
      accessToken,
      accessTokenExpiresAt,
    };
  }
}
