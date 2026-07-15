import { Injectable, Inject } from '@nestjs/common';
import { Password } from '@shared/domain/value-objects/password.vo';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort } from '@shared/application/ports/clock.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import {
  SYSTEM_CONFIG_KEYS,
  SystemConfigurationPort,
} from '@shared/application/ports/system-configuration.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import {
  PasswordResetCompletedEvent,
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
import { PasswordResetPolicy } from '../../domain/services/password-reset.policy';
import { OpaqueTokenService } from '../../domain/services/opaque-token.port';
import { PasswordHasher } from '../../domain/services/password-hasher.port';
import {
  CLOCK,
  DEVICE_SESSION_REPOSITORY,
  EVENT_PUBLISHER,
  ID_GENERATOR,
  OPAQUE_TOKEN_SERVICE,
  PASSWORD_HASHER,
  PASSWORD_HISTORY_REPOSITORY,
  PASSWORD_RESET_REPOSITORY,
  SYSTEM_CONFIGURATION,
  TOKEN_FAMILY_REPOSITORY,
  UNIT_OF_WORK,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';
import { ResetPasswordCommand } from '../dto/reset-password.command';
import { ResetPasswordResult } from '../dto/reset-password.result';
import { ExpiredResetTokenException } from '../exceptions/expired-reset-token.exception';
import { InvalidResetTokenException } from '../exceptions/invalid-reset-token.exception';

@Injectable()
export class ResetPasswordUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(PASSWORD_RESET_REPOSITORY)
    private readonly passwordResetRepository: PasswordResetRepository,
    @Inject(PASSWORD_HISTORY_REPOSITORY)
    private readonly passwordHistoryRepository: PasswordHistoryRepository,
    @Inject(DEVICE_SESSION_REPOSITORY)
    private readonly deviceSessionRepository: DeviceSessionRepository,
    @Inject(TOKEN_FAMILY_REPOSITORY)
    private readonly tokenFamilyRepository: TokenFamilyRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(OPAQUE_TOKEN_SERVICE) private readonly opaqueTokenService: OpaqueTokenService,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
  ) {}

  async execute(command: ResetPasswordCommand): Promise<ResetPasswordResult> {
    const token = command.token?.trim();
    if (!token || token.length === 0) {
      throw new InvalidResetTokenException();
    }

    const newPassword = Password.create(command.newPassword);
    const tokenHash = this.opaqueTokenService.hash(token);
    const tokenRecord = await this.passwordResetRepository.findByTokenHash(tokenHash);

    if (tokenRecord === null) {
      throw new InvalidResetTokenException();
    }

    if (!this.opaqueTokenService.verify(token, tokenRecord.tokenHash)) {
      throw new InvalidResetTokenException();
    }

    const now = this.clock.now();
    const tokenState = PasswordResetPolicy.resolveTokenState(tokenRecord, now);

    if (tokenState === 'consumed') {
      throw new InvalidResetTokenException();
    }

    if (tokenState === 'expired') {
      throw new ExpiredResetTokenException();
    }

    const user = await this.userRepository.findById(UserId.create(tokenRecord.userId));
    if (user === null || !PasswordResetPolicy.isUserEligibleForPasswordResetConsumption(user)) {
      throw new InvalidResetTokenException();
    }

    const passwordHistoryCount = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.passwordHistoryCount,
      5,
    );
    const history = await this.passwordHistoryRepository.findRecentByUserId(
      user.userId,
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
    const activeSessions = await this.deviceSessionRepository.findActiveByUserId(user.userId, now);

    const updatedUser = await this.unitOfWork.execute(async () => {
      const consumed = await this.passwordResetRepository.consumeIfActive(tokenRecord.id, now);
      if (!consumed) {
        throw new InvalidResetTokenException();
      }

      await this.passwordHistoryRepository.save({
        id: this.idGenerator.generate(),
        userId: user.userId.value,
        passwordHash: user.passwordHash.value,
        createdAt: now,
      });

      const resetUser = user.completePasswordReset(newPasswordHash, now);
      await this.userRepository.save(resetUser);

      await this.passwordResetRepository.invalidateActiveByUserId(user.userId);
      await this.passwordHistoryRepository.pruneBeyondLimit(user.userId, passwordHistoryCount);

      await this.deviceSessionRepository.revokeAllByUserId(user.userId, now, revokeReason);
      await this.tokenFamilyRepository.revokeAllByUserId(user.userId, now);

      return resetUser;
    });

    await this.eventPublisher.publish(
      new PasswordResetCompletedEvent(
        this.idGenerator.generate(),
        { userId: updatedUser.userId.value },
        now,
        command.correlationId,
      ),
    );

    for (const session of activeSessions) {
      await this.eventPublisher.publish(
        new SessionRevokedEvent(
          this.idGenerator.generate(),
          {
            userId: updatedUser.userId.value,
            sessionId: session.sessionId.value,
            reason: revokeReason,
          },
          now,
          command.correlationId,
        ),
      );
    }

    return { message: 'Password reset successfully.' };
  }
}
