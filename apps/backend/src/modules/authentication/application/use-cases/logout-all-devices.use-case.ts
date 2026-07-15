import { Injectable, Inject } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort } from '@shared/application/ports/clock.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import { SessionRevokeReason } from '../../domain/enums/authentication.enums';
import { UserLoggedOutEvent } from '../../domain/events/authentication.events';
import {
  DeviceSessionRepository,
  TokenFamilyRepository,
  UserRepository,
} from '../../domain/repositories/authentication.repositories';
import { InvalidAccessTokenException } from '../exceptions/access-token.exceptions';
import {
  CLOCK,
  DEVICE_SESSION_REPOSITORY,
  EVENT_PUBLISHER,
  ID_GENERATOR,
  TOKEN_FAMILY_REPOSITORY,
  UNIT_OF_WORK,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';
import { LogoutAllDevicesCommand, LogoutAllDevicesResult } from '../dto/logout-all-devices.dto';

@Injectable()
export class LogoutAllDevicesUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(DEVICE_SESSION_REPOSITORY)
    private readonly deviceSessionRepository: DeviceSessionRepository,
    @Inject(TOKEN_FAMILY_REPOSITORY)
    private readonly tokenFamilyRepository: TokenFamilyRepository,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(command: LogoutAllDevicesCommand): Promise<LogoutAllDevicesResult> {
    const now = this.clock.now();
    const userId = UserId.create(command.actor.userId);

    const newSessionVersion = await this.unitOfWork.execute(async () => {
      const version = await this.userRepository.incrementSessionVersion(userId, now);
      if (version === null) {
        throw new InvalidAccessTokenException();
      }

      await this.deviceSessionRepository.revokeAllByUserId(
        userId,
        now,
        SessionRevokeReason.SessionVersionBump,
      );
      await this.tokenFamilyRepository.revokeAllByUserId(userId, now);

      return version;
    });

    await this.eventPublisher.publish(
      new UserLoggedOutEvent(
        this.idGenerator.generate(),
        {
          userId: userId.value,
          scope: 'all',
        },
        now,
        command.correlationId,
      ),
    );

    return { sessionVersion: newSessionVersion };
  }
}
