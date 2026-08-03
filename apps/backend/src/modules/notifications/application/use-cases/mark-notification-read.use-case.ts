import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { NotificationId } from '@shared/domain/value-objects/identifiers.vo';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { NotificationNotFoundException } from '../../domain/exceptions/notification-not-found.exception';
import {
  NOTIFICATION_REPOSITORY,
  NotificationRepository,
} from '../../domain/repositories/notification.repository';
import { NotificationResult } from '../dto/notification.result';

export interface MarkNotificationReadCommand {
  actor: AuthenticatedActor;
  notificationId: string;
}

/**
 * Ownership-only, IDOR-safe (`AUTHORIZATION_ARCHITECTURE.md` §10): a
 * notification that does not exist, or belongs to a different user, throws
 * the identical `NotificationNotFoundException` (404) - never distinguished
 * from a genuine not-found. Idempotent - marking an already-read
 * notification read again succeeds (`Notification.markRead`'s own no-op
 * guard), never a 409/400.
 */
@Injectable()
export class MarkNotificationReadUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepository: NotificationRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: MarkNotificationReadCommand): Promise<NotificationResult> {
    const notification = await this.notificationRepository.findById(
      NotificationId.create(command.notificationId),
    );
    if (notification === null || notification.userId.value !== command.actor.userId) {
      throw new NotificationNotFoundException();
    }

    const updated = notification.markRead(this.clock.now());
    await this.notificationRepository.save(updated);

    return {
      id: updated.id,
      type: updated.type,
      title: updated.title,
      body: updated.body,
      data: updated.data,
      read: updated.read,
      readAt: updated.readAt,
      createdAt: updated.createdAt,
    };
  }
}
