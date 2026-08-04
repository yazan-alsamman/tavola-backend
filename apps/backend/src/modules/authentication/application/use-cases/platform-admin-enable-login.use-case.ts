import { Injectable, Inject } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UserRepository } from '../../domain/repositories/authentication.repositories';
import { USER_REPOSITORY } from '../../domain/tokens/authentication.tokens';
import { UserStatus } from '../../domain/enums/authentication.enums';
import { UserNotFoundException } from '../exceptions/user-not-found.exception';
import { AccountNotDisabledException } from '../../domain/exceptions/account-not-disabled.exception';
import { AccountLoginEnabledEvent } from '../../domain/events/authentication.events';
import { PlatformAdminEnableLoginCommand } from '../dto/platform-admin-account-access.dto';

/** ADR-034 §8 - only valid from `Suspended` (see `User.enableLogin()`'s own doc comment for why). */
@Injectable()
export class PlatformAdminEnableLoginUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(command: PlatformAdminEnableLoginCommand): Promise<void> {
    const user = await this.userRepository.findById(UserId.create(command.targetUserId));
    if (user === null) {
      throw new UserNotFoundException();
    }
    if (user.status !== UserStatus.Suspended) {
      throw new AccountNotDisabledException();
    }

    const now = this.clock.now();
    const enabled = user.enableLogin(now);
    await this.userRepository.save(enabled);

    await this.eventPublisher.publish(
      new AccountLoginEnabledEvent(
        this.idGenerator.generate(),
        { targetUserId: command.targetUserId, actorId: command.actorId },
        now,
        command.correlationId,
      ),
    );
  }
}
