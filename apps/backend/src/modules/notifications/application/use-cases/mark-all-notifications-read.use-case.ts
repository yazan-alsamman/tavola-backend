import { Inject, Injectable } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { CLOCK } from '@modules/authentication/domain/tokens/authentication.tokens';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import {
  NOTIFICATION_REPOSITORY,
  NotificationRepository,
} from '../../domain/repositories/notification.repository';

export interface MarkAllNotificationsReadCommand {
  actor: AuthenticatedActor;
}

@Injectable()
export class MarkAllNotificationsReadUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepository: NotificationRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: MarkAllNotificationsReadCommand): Promise<void> {
    const userId = UserId.create(command.actor.userId);
    await this.notificationRepository.markAllReadByUser(userId, this.clock.now());
  }
}
