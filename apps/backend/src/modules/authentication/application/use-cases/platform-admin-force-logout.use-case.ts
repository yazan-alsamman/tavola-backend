import { Injectable, Inject } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { SessionRevokeReason } from '../../domain/enums/authentication.enums';
import { SessionFamilyRevokedEvent } from '../../domain/events/authentication.events';
import {
  DeviceSessionRepository,
  TokenFamilyRepository,
} from '../../domain/repositories/authentication.repositories';
import { UserNotFoundException } from '../exceptions/user-not-found.exception';
import {
  DEVICE_SESSION_REPOSITORY,
  TOKEN_FAMILY_REPOSITORY,
  USER_REPOSITORY,
} from '../../domain/tokens/authentication.tokens';
import { UserRepository } from '../../domain/repositories/authentication.repositories';
import { PlatformAdminForceLogoutCommand } from '../dto/platform-admin-account-access.dto';

/**
 * ADR-034 §8. Reuses the existing `sessionVersion` mechanism and the
 * already-documented "Admin suspends user" / "Admin force-logout user"
 * session-revocation trigger (AUTHENTICATION_ARCHITECTURE.md §1.8/§4.5) -
 * no new event. Mirrors `LogoutAllDevicesUseCase`'s shape exactly, targeting
 * an arbitrary account instead of the caller's own: bumps `sessionVersion`,
 * revokes every `DeviceSession`/`TokenFamily`. Publishes the existing
 * `SessionFamilyRevokedEvent` with `reason: SessionRevokeReason.Admin` and
 * `actorId` set to the PlatformAdmin (see that event's own doc comment) -
 * `AuditingEventPublisher` branches on `reason` to attribute `actorType:
 * 'PlatformAdmin'` instead of `'User'`, correctly distinguishing this from
 * self-service logout-all/reuse-detected revocation.
 */
@Injectable()
export class PlatformAdminForceLogoutUseCase {
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

  async execute(command: PlatformAdminForceLogoutCommand): Promise<void> {
    const now = this.clock.now();
    const userId = UserId.create(command.targetUserId);

    await this.unitOfWork.execute(async () => {
      const version = await this.userRepository.incrementSessionVersion(userId, now);
      if (version === null) {
        throw new UserNotFoundException();
      }
      await this.deviceSessionRepository.revokeAllByUserId(userId, now, SessionRevokeReason.Admin);
      await this.tokenFamilyRepository.revokeAllByUserId(userId, now);
    });

    await this.eventPublisher.publish(
      new SessionFamilyRevokedEvent(
        this.idGenerator.generate(),
        {
          userId: command.targetUserId,
          tokenFamilyId: 'all',
          reason: SessionRevokeReason.Admin,
          actorId: command.actorId,
        },
        now,
        command.correlationId,
      ),
    );
  }
}
