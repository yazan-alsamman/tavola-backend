import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { USER_REPOSITORY } from '@modules/authentication/domain/tokens/authentication.tokens';
import { UserNotFoundException } from '@modules/authentication/application/exceptions/user-not-found.exception';
import { UpdateUserPreferencesCommand } from '../dto/update-user-preferences.command';
import { UserPreferencesResult } from '../dto/user-preferences.result';

@Injectable()
export class UpdateUserPreferencesUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: UpdateUserPreferencesCommand): Promise<UserPreferencesResult> {
    const userId = UserId.create(command.actor.userId);
    const user = await this.userRepository.findById(userId);
    if (user === null) {
      throw new UserNotFoundException();
    }

    const now = this.clock.now();
    const updated = user.updatePreferences(
      {
        notificationOptIn: command.notificationOptIn,
        marketingOptIn: command.marketingOptIn,
      },
      now,
    );

    await this.userRepository.save(updated);

    // Fire-and-forget per AuditLogWriterPort's own contract, matching
    // UpdateUserProfileUseCase - no EVENTS.md entry exists for a preferences
    // change and it has no other consumer today, so a direct audit write is
    // the smallest correct mechanism rather than inventing a new event type.
    await this.auditLogWriter.record({
      actorId: userId.value,
      actorType: 'User',
      action: 'user.preferences.updated',
      targetType: 'User',
      targetId: userId.value,
      organizationId: null,
      correlationId: command.correlationId ?? null,
      ipAddress: command.ipAddress,
      occurredAt: now,
    });

    return {
      userId: updated.userId.value,
      notificationOptIn: updated.notificationOptIn,
      marketingOptIn: updated.marketingOptIn,
      updatedAt: updated.updatedAt,
    };
  }
}
