import { Injectable, Inject } from '@nestjs/common';
import { Email } from '@shared/domain/value-objects/email.vo';
import { Password } from '@shared/domain/value-objects/password.vo';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { User } from '@modules/authentication/domain/entities/user.entity';
import { UserStatus } from '@modules/authentication/domain/enums/authentication.enums';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { PasswordHasher } from '@modules/authentication/domain/services/password-hasher.port';
import {
  PASSWORD_HASHER,
  USER_REPOSITORY,
} from '@modules/authentication/domain/tokens/authentication.tokens';
import {
  PlatformAdminRepository,
  PLATFORM_ADMIN_REPOSITORY,
} from '../../domain/repositories/platform-admin.repository';
import { PlatformAdminAccountCreatedEvent } from '../../domain/events/platform-admin.events';
import {
  CreatePlatformAdminCommand,
  PlatformAdminAccountResult,
} from '../dto/platform-admin-account.dto';
import { toPlatformAdminAccountResult } from '../mappers/platform-admin-account.mapper';

/**
 * ADR-034 §10 (FR-19.1) — API-driven creation applies only to accounts
 * created after the operational bootstrap seed (`prisma/seed.ts`'s
 * `PLATFORM_ADMIN_BOOTSTRAP_*` row). Mirrors `ProvisionRestaurantOwnerUseCase`'s
 * trust model exactly (ADR-022 Decision #15): the caller-supplied password
 * is the final password, immediately `Active`/`emailVerified: true`, no OTP/
 * verification step, credential communication out-of-band. Unlike Restaurant
 * Owner provisioning, no Organization/Subscription/UserConsent is created —
 * a Platform Admin is an internal operations account, not a tenant.
 */
@Injectable()
export class CreatePlatformAdminUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(PLATFORM_ADMIN_REPOSITORY)
    private readonly platformAdminRepository: PlatformAdminRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(command: CreatePlatformAdminCommand): Promise<PlatformAdminAccountResult> {
    const email = Email.create(command.email);
    const password = Password.create(command.password);
    const now = this.clock.now();
    const userId = UserId.create(this.idGenerator.generate());
    const platformAdminId = this.idGenerator.generate();

    const passwordHash = await this.passwordHasher.hash(password);
    const user = User.create({
      id: userId.value,
      firstName: command.firstName.trim(),
      lastName: command.lastName.trim(),
      email: email.value,
      phone: null,
      username: null,
      passwordHash: passwordHash.value,
      language: 'en',
      preferredCurrency: null,
      notificationOptIn: true,
      marketingOptIn: false,
      status: UserStatus.Active,
      emailVerified: true,
      failedLoginCount: 0,
      lockedUntil: null,
      permissionsVersion: 1,
      sessionVersion: 1,
      passwordChangedAt: null,
      lastLoginAt: null,
      anonymizedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    await this.unitOfWork.execute(async () => {
      // P2002 on the unique email constraint surfaces as EmailAlreadyExistsException
      // from PrismaUserRepository.save (Phase 2.12 closure) - no manual
      // existsByEmail precheck needed, matching every other provisioning
      // use case in this codebase.
      await this.userRepository.save(user);
      await this.platformAdminRepository.create({
        id: platformAdminId,
        userId: userId.value,
        role: command.role,
        createdAt: now,
        revokedAt: null,
      });
    });

    await this.eventPublisher.publish(
      new PlatformAdminAccountCreatedEvent(
        this.idGenerator.generate(),
        { platformAdminId, role: command.role, actorId: command.actorId },
        now,
        command.correlationId,
      ),
    );

    return toPlatformAdminAccountResult(
      {
        id: platformAdminId,
        userId: userId.value,
        role: command.role,
        createdAt: now,
        revokedAt: null,
      },
      email.value,
    );
  }
}
