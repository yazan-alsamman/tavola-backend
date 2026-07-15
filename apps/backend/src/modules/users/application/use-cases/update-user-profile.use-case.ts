import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import {
  CLOCK,
  USER_REPOSITORY,
} from '@modules/authentication/domain/tokens/authentication.tokens';
import { UserNotFoundException } from '@modules/authentication/application/exceptions/user-not-found.exception';
import { UpdateUserProfileCommand } from '../dto/update-user-profile.command';
import { UserProfileResult } from '../dto/user-profile.result';

@Injectable()
export class UpdateUserProfileUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: UpdateUserProfileCommand): Promise<UserProfileResult> {
    const userId = UserId.create(command.actor.userId);
    const user = await this.userRepository.findById(userId);
    if (user === null) {
      throw new UserNotFoundException();
    }

    const now = this.clock.now();
    const updated = user.updateProfile(
      {
        firstName: command.firstName,
        lastName: command.lastName,
        phone: command.phone,
        language: command.language,
        preferredCurrency: command.preferredCurrency,
      },
      now,
    );

    await this.userRepository.save(updated);

    // Fire-and-forget per AuditLogWriterPort's own contract - not part of the
    // same transaction as the save() above, matching every other use case in
    // this codebase (e.g. JwtAuthGuard, ChangePasswordUseCase's rate-limit
    // audit writes). No domain event exists for this in EVENTS.md, and a
    // routine profile edit has no other consumer (WebSocket/BullMQ/Analytics)
    // today, so a direct audit write is the smallest correct mechanism rather
    // than inventing a new event type.
    await this.auditLogWriter.record({
      actorId: userId.value,
      actorType: 'User',
      action: 'user.profile.updated',
      targetType: 'User',
      targetId: userId.value,
      organizationId: null,
      correlationId: command.correlationId ?? null,
      ipAddress: command.ipAddress,
      occurredAt: now,
    });

    return {
      userId: updated.userId.value,
      firstName: updated.firstName,
      lastName: updated.lastName,
      email: updated.email.value,
      phone: updated.phone,
      language: updated.language,
      preferredCurrency: updated.preferredCurrency,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }
}
