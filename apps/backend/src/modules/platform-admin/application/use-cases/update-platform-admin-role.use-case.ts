import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { USER_REPOSITORY } from '@modules/authentication/domain/tokens/authentication.tokens';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import {
  PlatformAdminRepository,
  PLATFORM_ADMIN_REPOSITORY,
} from '../../domain/repositories/platform-admin.repository';
import { PlatformAdminNotFoundException } from '../../domain/exceptions/platform-admin-not-found.exception';
import { CannotModifyOwnPlatformAdminAccountException } from '../../domain/exceptions/cannot-modify-own-platform-admin-account.exception';
import { PlatformAdminRoleChangedEvent } from '../../domain/events/platform-admin.events';
import {
  PlatformAdminAccountResult,
  UpdatePlatformAdminRoleCommand,
} from '../dto/platform-admin-account.dto';
import { toPlatformAdminAccountResult } from '../mappers/platform-admin-account.mapper';

/**
 * "Update Platform Admin" (Phase 19.1 scope) - `role` is the only mutable
 * business field `PlatformAdmin` has (no name/email lives on this table;
 * those are `User` profile fields, out of this capability's scope).
 */
@Injectable()
export class UpdatePlatformAdminRoleUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_REPOSITORY)
    private readonly platformAdminRepository: PlatformAdminRepository,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: UpdatePlatformAdminRoleCommand): Promise<PlatformAdminAccountResult> {
    const existing = await this.platformAdminRepository.findById(command.platformAdminId);
    if (existing === null) {
      throw new PlatformAdminNotFoundException();
    }
    if (existing.userId === command.actorId) {
      throw new CannotModifyOwnPlatformAdminAccountException();
    }

    const now = this.clock.now();
    await this.platformAdminRepository.updateRole(command.platformAdminId, command.role, now);

    await this.eventPublisher.publish(
      new PlatformAdminRoleChangedEvent(
        this.idGenerator.generate(),
        {
          platformAdminId: command.platformAdminId,
          role: command.role,
          previousRole: existing.role,
          actorId: command.actorId,
        },
        now,
        command.correlationId,
      ),
    );

    const user = await this.userRepository.findById(UserId.create(existing.userId));
    return toPlatformAdminAccountResult(
      { ...existing, role: command.role },
      user?.email?.value ?? null,
    );
  }
}
