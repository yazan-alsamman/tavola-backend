import { Injectable, Inject } from '@nestjs/common';
import { Email } from '@shared/domain/value-objects/email.vo';
import { Password } from '@shared/domain/value-objects/password.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  SYSTEM_CONFIG_KEYS,
  SystemConfigurationPort,
} from '@shared/application/ports/system-configuration.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { PasswordResetRequestedEvent } from '../../domain/events/authentication.events';
import {
  PasswordResetRepository,
  UserRepository,
} from '../../domain/repositories/authentication.repositories';
import { PasswordResetPolicy } from '../../domain/services/password-reset.policy';
import { OpaqueTokenService } from '../../domain/services/opaque-token.port';
import { PasswordHasher } from '../../domain/services/password-hasher.port';
import {
  TIMING_SAFE_DUMMY_PASSWORD,
  TIMING_SAFE_DUMMY_PASSWORD_HASH,
} from '../../domain/services/timing-safe-dummy';
import {
  OPAQUE_TOKEN_SERVICE,
  PASSWORD_HASHER,
  PASSWORD_RESET_REPOSITORY,
  SYSTEM_CONFIGURATION,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';
import { ForgotPasswordCommand } from '../dto/forgot-password.command';
import {
  FORGOT_PASSWORD_GENERIC_MESSAGE,
  ForgotPasswordResult,
} from '../dto/forgot-password.result';

@Injectable()
export class ForgotPasswordUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(PASSWORD_RESET_REPOSITORY)
    private readonly passwordResetRepository: PasswordResetRepository,
    @Inject(OPAQUE_TOKEN_SERVICE) private readonly opaqueTokenService: OpaqueTokenService,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
  ) {}

  async execute(command: ForgotPasswordCommand): Promise<ForgotPasswordResult> {
    const now = this.clock.now();
    const email = Email.create(command.email);

    const user = await this.userRepository.findByEmail(email);

    const opaqueResetToken = this.opaqueTokenService.generate();
    const tokenHash = this.opaqueTokenService.hash(opaqueResetToken);

    if (user === null || !PasswordResetPolicy.isUserEligibleForPasswordResetRequest(user)) {
      // Dummy Argon2 verification to equalize response timing with the
      // eligible-user branch below, which performs comparable Argon2-scale
      // work (password history / hashing elsewhere) plus DB writes — without
      // this, an unknown or ineligible email would respond measurably faster,
      // leaking account existence via timing (see AUTHENTICATION_ARCHITECTURE.md
      // §12.1, "user enumeration ... mitigate with constant work").
      await this.passwordHasher.verify(
        Password.create(TIMING_SAFE_DUMMY_PASSWORD),
        PasswordHash.create(TIMING_SAFE_DUMMY_PASSWORD_HASH),
      );
      return { message: FORGOT_PASSWORD_GENERIC_MESSAGE };
    }

    const resetTokenTtlHours = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.passwordResetTokenTtlHours,
      1,
    );
    const expiresAt = new Date(now.getTime() + resetTokenTtlHours * 3_600_000);
    const tokenId = this.idGenerator.generate();

    await this.unitOfWork.execute(async () => {
      await this.userRepository.save(user);
      await this.passwordResetRepository.invalidateActiveByUserId(user.userId);
      await this.passwordResetRepository.save({
        id: tokenId,
        userId: user.userId.value,
        tokenHash,
        expiresAt,
        consumedAt: null,
        createdAt: now,
      });
    });

    await this.eventPublisher.publish(
      new PasswordResetRequestedEvent(
        this.idGenerator.generate(),
        { userId: user.userId.value },
        now,
        command.correlationId,
      ),
    );

    return { message: FORGOT_PASSWORD_GENERIC_MESSAGE };
  }
}
