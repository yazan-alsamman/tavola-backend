import { Injectable, Inject } from '@nestjs/common';
import { SessionId, TokenFamilyId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort } from '@shared/application/ports/clock.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import { SessionRevokeReason } from '../../domain/enums/authentication.enums';
import { SessionRevokedEvent, UserLoggedOutEvent } from '../../domain/events/authentication.events';
import { DeviceSessionRepository } from '../../domain/repositories/authentication.repositories';
import { InvalidAccessTokenException } from '../exceptions/access-token.exceptions';
import {
  CLOCK,
  DEVICE_SESSION_REPOSITORY,
  EVENT_PUBLISHER,
  ID_GENERATOR,
  UNIT_OF_WORK,
} from '../../domain/tokens/authentication.tokens';
import {
  LogoutCurrentSessionCommand,
  LogoutCurrentSessionResult,
} from '../dto/logout-current-session.dto';

@Injectable()
export class LogoutCurrentSessionUseCase {
  constructor(
    @Inject(DEVICE_SESSION_REPOSITORY)
    private readonly deviceSessionRepository: DeviceSessionRepository,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(command: LogoutCurrentSessionCommand): Promise<LogoutCurrentSessionResult> {
    const now = this.clock.now();
    const sessionId = SessionId.create(command.actor.sessionId);
    const userId = UserId.create(command.actor.userId);
    const tokenFamilyId = TokenFamilyId.create(command.actor.tokenFamilyId);

    const session = await this.deviceSessionRepository.findById(sessionId);
    if (
      session === null ||
      !session.belongsToUser(userId) ||
      !session.matchesTokenFamily(tokenFamilyId)
    ) {
      throw new InvalidAccessTokenException();
    }

    if (session.isRevoked()) {
      return { sessionId: session.sessionId.value };
    }

    const revoked = session.revoke(SessionRevokeReason.Logout, now);

    await this.unitOfWork.execute(async () => {
      await this.deviceSessionRepository.save(revoked);
    });

    await this.eventPublisher.publish(
      new UserLoggedOutEvent(
        this.idGenerator.generate(),
        {
          userId: userId.value,
          sessionId: session.sessionId.value,
          scope: 'current',
        },
        now,
        command.correlationId,
      ),
    );

    await this.eventPublisher.publish(
      new SessionRevokedEvent(
        this.idGenerator.generate(),
        {
          userId: userId.value,
          sessionId: session.sessionId.value,
          reason: SessionRevokeReason.Logout,
        },
        now,
        command.correlationId,
      ),
    );

    return { sessionId: session.sessionId.value };
  }
}
