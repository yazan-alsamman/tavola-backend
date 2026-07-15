import { Injectable, Inject } from '@nestjs/common';
import { SessionId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort } from '@shared/application/ports/clock.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import { SessionRevokeReason } from '../../domain/enums/authentication.enums';
import { SessionRevokedEvent } from '../../domain/events/authentication.events';
import { DeviceSessionRepository } from '../../domain/repositories/authentication.repositories';
import { SessionAccessDeniedException } from '../exceptions/session-access-denied.exception';
import {
  CLOCK,
  DEVICE_SESSION_REPOSITORY,
  EVENT_PUBLISHER,
  ID_GENERATOR,
  UNIT_OF_WORK,
} from '../../domain/tokens/authentication.tokens';
import { RevokeSessionCommand, RevokeSessionResult } from '../dto/revoke-session.dto';

@Injectable()
export class RevokeSessionUseCase {
  constructor(
    @Inject(DEVICE_SESSION_REPOSITORY)
    private readonly deviceSessionRepository: DeviceSessionRepository,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(command: RevokeSessionCommand): Promise<RevokeSessionResult> {
    const now = this.clock.now();
    const userId = UserId.create(command.actor.userId);
    const sessionId = SessionId.create(command.targetSessionId);

    const outcome = await this.unitOfWork.execute(async () =>
      this.deviceSessionRepository.revokeByIdIfOwnedByUser({
        sessionId,
        userId,
        at: now,
        reason: SessionRevokeReason.Logout,
      }),
    );

    if (outcome.status === 'not_found_or_not_owned') {
      throw new SessionAccessDeniedException();
    }

    if (outcome.status === 'already_revoked') {
      return { sessionId: sessionId.value };
    }

    await this.eventPublisher.publish(
      new SessionRevokedEvent(
        this.idGenerator.generate(),
        {
          userId: userId.value,
          sessionId: sessionId.value,
          reason: SessionRevokeReason.Logout,
        },
        now,
        command.correlationId,
      ),
    );

    return { sessionId: sessionId.value };
  }
}
