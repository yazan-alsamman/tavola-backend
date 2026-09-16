import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import {
  PlatformAdminRepository,
  PLATFORM_ADMIN_REPOSITORY,
} from '../../domain/repositories/platform-admin.repository';
import { PlatformAdminSessionRevokeReason } from '../../domain/enums/platform-admin.enums';
import {
  PlatformAdminSessionRepository,
  PLATFORM_ADMIN_SESSION_REPOSITORY,
} from '../../domain/repositories/platform-admin-session.repository';
import { PlatformAdminNotFoundException } from '../../domain/exceptions/platform-admin-not-found.exception';
import { CannotModifyOwnPlatformAdminAccountException } from '../../domain/exceptions/cannot-modify-own-platform-admin-account.exception';
import { PlatformAdminAccountRevokedEvent } from '../../domain/events/platform-admin.events';
import { DeactivatePlatformAdminCommand } from '../dto/platform-admin-account.dto';

/**
 * ADR-034 §10's "revoke" capability - finally makes `PlatformAdmin.revokedAt`
 * reachable. Terminal in the same sense Employee removal is terminal (no
 * hard delete anywhere in this codebase's admin-like entities) - see
 * `ReactivatePlatformAdminUseCase` for the explicit un-revoke path this
 * phase adds on top of ADR-034's literal text. Also serves as "Delete
 * Platform Admin" per this session's scoping decision - architecture has no
 * hard-delete precedent for an audit-relevant entity.
 */
@Injectable()
export class DeactivatePlatformAdminUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_REPOSITORY)
    private readonly platformAdminRepository: PlatformAdminRepository,
    @Inject(PLATFORM_ADMIN_SESSION_REPOSITORY)
    private readonly sessionRepository: PlatformAdminSessionRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: DeactivatePlatformAdminCommand): Promise<void> {
    const existing = await this.platformAdminRepository.findById(command.platformAdminId);
    if (existing === null) {
      throw new PlatformAdminNotFoundException();
    }
    if (existing.userId === command.actorId) {
      throw new CannotModifyOwnPlatformAdminAccountException();
    }

    const now = this.clock.now();
    await this.platformAdminRepository.revoke(command.platformAdminId, now);

    // Revoking the grant without revoking the sessions would leave a
    // deactivated admin holding a refresh token that still rotates.
    // `PlatformAdminGuard` already blocks every *request* the moment the
    // grant is revoked (it re-reads the live row), and the refresh use case
    // re-checks the grant too; this is the third and cheapest layer - the
    // session rows are closed outright rather than left to their sliding
    // expiry, so nothing usable survives the deactivation.
    await this.sessionRepository.revokeAllByPlatformAdminUserId(
      existing.userId,
      PlatformAdminSessionRevokeReason.Admin,
      now,
    );

    await this.eventPublisher.publish(
      new PlatformAdminAccountRevokedEvent(
        this.idGenerator.generate(),
        { platformAdminId: command.platformAdminId, role: existing.role, actorId: command.actorId },
        now,
        command.correlationId,
      ),
    );
  }
}
