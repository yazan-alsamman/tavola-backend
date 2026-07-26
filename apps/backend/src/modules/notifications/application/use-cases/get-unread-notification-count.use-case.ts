import { Inject, Injectable } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import {
  NOTIFICATION_REPOSITORY,
  NotificationRepository,
} from '../../domain/repositories/notification.repository';

export interface GetUnreadNotificationCountCommand {
  actor: AuthenticatedActor;
}

export interface UnreadNotificationCountResult {
  count: number;
}

@Injectable()
export class GetUnreadNotificationCountUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepository: NotificationRepository,
  ) {}

  async execute(
    command: GetUnreadNotificationCountCommand,
  ): Promise<UnreadNotificationCountResult> {
    const userId = UserId.create(command.actor.userId);
    const count = await this.notificationRepository.countUnreadByUser(userId);
    return { count };
  }
}
