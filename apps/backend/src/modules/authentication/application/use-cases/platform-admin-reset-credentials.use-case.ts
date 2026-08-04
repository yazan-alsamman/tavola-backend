import { Injectable, Inject } from '@nestjs/common';
import { Password } from '@shared/domain/value-objects/password.vo';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UserRepository } from '../../domain/repositories/authentication.repositories';
import { PasswordHasher } from '../../domain/services/password-hasher.port';
import { USER_REPOSITORY, PASSWORD_HASHER } from '../../domain/tokens/authentication.tokens';
import { UserNotFoundException } from '../exceptions/user-not-found.exception';
import { PlatformAdminCredentialResetEvent } from '../../domain/events/authentication.events';
import { PlatformAdminResetCredentialsCommand } from '../dto/platform-admin-account-access.dto';

/**
 * ADR-034 §8. A distinct flow from self-service password reset (`ResetPasswordUseCase`)
 * - no OTP step, direct set by the admin, mirroring the trust model already
 * established for Restaurant Owner provisioning (`ProvisionRestaurantOwnerUseCase`,
 * ADR-022 Decision #15). Reuses `User.completePasswordReset()` unchanged -
 * bumps `sessionVersion` (forcing re-authentication everywhere) and clears
 * any lock/failed-attempt state, identical side effects to a self-service
 * reset, just without the token-verification precondition.
 */
@Injectable()
export class PlatformAdminResetCredentialsUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(command: PlatformAdminResetCredentialsCommand): Promise<void> {
    const user = await this.userRepository.findById(UserId.create(command.targetUserId));
    if (user === null) {
      throw new UserNotFoundException();
    }

    const now = this.clock.now();
    const newHash = await this.passwordHasher.hash(Password.create(command.newPassword));
    const updated = user.completePasswordReset(newHash, now);
    await this.userRepository.save(updated);

    await this.eventPublisher.publish(
      new PlatformAdminCredentialResetEvent(
        this.idGenerator.generate(),
        { targetUserId: command.targetUserId, resetBy: command.actorId },
        now,
        command.correlationId,
      ),
    );
  }
}
