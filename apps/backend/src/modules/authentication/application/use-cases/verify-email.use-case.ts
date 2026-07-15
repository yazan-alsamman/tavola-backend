import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { UserRepository } from '../../domain/repositories/authentication.repositories';
import { EmailVerificationRepository } from '../../domain/repositories/authentication.repositories';
import { OpaqueTokenService } from '../../domain/services/opaque-token.port';
import { EmailVerificationPolicy } from '../../domain/services/email-verification.policy';
import { EmailVerifiedEvent } from '../../domain/events/authentication.events';
import { UserStatus } from '../../domain/enums/authentication.enums';
import { VerifyEmailCommand } from '../dto/verify-email.command';
import { VerifyEmailResult } from '../dto/verify-email.result';
import { InvalidVerificationTokenException } from '../exceptions/invalid-verification-token.exception';
import { ExpiredVerificationTokenException } from '../exceptions/expired-verification-token.exception';
import { EmailAlreadyVerifiedException } from '../exceptions/email-already-verified.exception';
import { UserNotFoundException } from '../exceptions/user-not-found.exception';
import {
  CLOCK,
  EMAIL_VERIFICATION_REPOSITORY,
  EVENT_PUBLISHER,
  ID_GENERATOR,
  OPAQUE_TOKEN_SERVICE,
  UNIT_OF_WORK,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';

@Injectable()
export class VerifyEmailUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(EMAIL_VERIFICATION_REPOSITORY)
    private readonly emailVerificationRepository: EmailVerificationRepository,
    @Inject(OPAQUE_TOKEN_SERVICE) private readonly opaqueTokenService: OpaqueTokenService,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(command: VerifyEmailCommand): Promise<VerifyEmailResult> {
    const token = command.token?.trim();
    if (!token || token.length === 0) {
      throw new InvalidVerificationTokenException();
    }

    const tokenHash = this.opaqueTokenService.hash(token);
    const tokenRecord = await this.emailVerificationRepository.findByTokenHash(tokenHash);

    if (tokenRecord === null) {
      throw new InvalidVerificationTokenException();
    }

    if (!this.opaqueTokenService.verify(token, tokenRecord.tokenHash)) {
      throw new InvalidVerificationTokenException();
    }

    const now = this.clock.now();
    const tokenState = EmailVerificationPolicy.resolveTokenState(tokenRecord, now);

    if (tokenState === 'consumed') {
      throw new InvalidVerificationTokenException();
    }

    if (tokenState === 'expired') {
      throw new ExpiredVerificationTokenException();
    }

    const user = await this.userRepository.findById(UserId.create(tokenRecord.userId));
    if (user === null) {
      throw new UserNotFoundException();
    }

    if (EmailVerificationPolicy.isAlreadyVerified(user)) {
      throw new EmailAlreadyVerifiedException();
    }

    if (!EmailVerificationPolicy.isUserEligibleForVerification(user)) {
      throw new InvalidVerificationTokenException();
    }

    const verifiedUser = await this.unitOfWork.execute(async () => {
      const consumed = await this.emailVerificationRepository.consumeIfActive(tokenRecord.id, now);

      if (!consumed) {
        throw new InvalidVerificationTokenException();
      }

      const updatedUser = user.verifyEmail(now);
      await this.userRepository.save(updatedUser);
      return updatedUser;
    });

    await this.eventPublisher.publish(
      new EmailVerifiedEvent(
        this.idGenerator.generate(),
        { userId: verifiedUser.userId.value },
        now,
        command.correlationId,
      ),
    );

    return {
      userId: verifiedUser.userId.value,
      email: verifiedUser.email.value,
      status: UserStatus.Active,
    };
  }
}
