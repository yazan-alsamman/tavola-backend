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
import { UserNotFoundException } from '../exceptions/user-not-found.exception';
import { AccountLoginDisabledEvent } from '../../domain/events/authentication.events';
import { PlatformAdminDisableLoginCommand } from '../dto/platform-admin-account-access.dto';

/** ADR-034 §8 - reuses the existing `User.status` field, no new column. Idempotent (`User.disableLogin()`'s own no-op-if-already-Suspended invariant). */
@Injectable()
export class PlatformAdminDisableLoginUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(command: PlatformAdminDisableLoginCommand): Promise<void> {
    const user = await this.userRepository.findById(UserId.create(command.targetUserId));
    if (user === null) {
      throw new UserNotFoundException();
    }

    const now = this.clock.now();
    const disabled = user.disableLogin(now);
    await this.userRepository.save(disabled);

    await this.eventPublisher.publish(
      new AccountLoginDisabledEvent(
        this.idGenerator.generate(),
        { targetUserId: command.targetUserId, actorId: command.actorId },
        now,
        command.correlationId,
      ),
    );
  }
}
