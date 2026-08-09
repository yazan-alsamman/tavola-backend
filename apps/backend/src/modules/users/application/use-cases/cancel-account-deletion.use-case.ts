import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { USER_REPOSITORY } from '@modules/authentication/domain/tokens/authentication.tokens';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { InvalidAccessTokenException } from '@modules/authentication/application/exceptions/access-token.exceptions';
import { UserAccountDeletionCancelledEvent } from '@modules/authentication/domain/events/authentication.events';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import {
  AccountDeletionSchedulerPort,
  ACCOUNT_DELETION_SCHEDULER,
} from '../ports/account-deletion-scheduler.port';
import { CancelAccountDeletionCommand } from '../dto/cancel-account-deletion.command';

/**
 * Phase 20.X (ADR-014 execution) - `POST /users/me/cancel-deletion`, within
 * the grace period. No password required: a freshly-issued JWT (obtained
 * by logging back in, since `RequestAccountDeletionUseCase` already revoked
 * every prior session) is already proof of credential possession.
 *
 * Idempotent, matching `User.cancelDeletionRequest()`'s own no-op-if-
 * nothing-pending guard (mirrors the Phase 19.1 M1 pattern): calling this
 * with no pending request is a silent success, not an error - no event, no
 * duplicate audit row.
 */
@Injectable()
export class CancelAccountDeletionUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(ACCOUNT_DELETION_SCHEDULER)
    private readonly accountDeletionScheduler: AccountDeletionSchedulerPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(command: CancelAccountDeletionCommand): Promise<void> {
    if (command.actor.actorType !== AccessTokenActorType.User) {
      throw new PermissionDeniedException();
    }

    const userId = UserId.create(command.actor.userId);
    const user = await this.userRepository.findById(userId);
    if (user === null) {
      throw new InvalidAccessTokenException();
    }

    if (!user.hasPendingDeletionRequest()) {
      return;
    }

    const now = this.clock.now();
    const cancelled = user.cancelDeletionRequest(now);
    await this.userRepository.save(cancelled);
    await this.accountDeletionScheduler.cancelAnonymization(userId.value);

    await this.eventPublisher.publish(
      new UserAccountDeletionCancelledEvent(
        this.idGenerator.generate(),
        { userId: userId.value },
        now,
        command.correlationId,
      ),
    );
  }
}
