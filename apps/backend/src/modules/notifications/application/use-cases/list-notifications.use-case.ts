import { Inject, Injectable } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import {
  NOTIFICATION_REPOSITORY,
  NotificationRepository,
} from '../../domain/repositories/notification.repository';
import { ListNotificationsCommand } from '../dto/list-notifications.command';
import { NotificationListResult } from '../dto/notification-list.result';
import { NotificationResult } from '../dto/notification.result';

@Injectable()
export class ListNotificationsUseCase {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepository: NotificationRepository,
  ) {}

  async execute(command: ListNotificationsCommand): Promise<NotificationListResult> {
    const userId = UserId.create(command.actor.userId);
    const page = await this.notificationRepository.listByUser(userId, command.page, command.limit, {
      unreadOnly: command.unreadOnly,
    });

    const items: NotificationResult[] = page.items.map((notification) => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      read: notification.read,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    }));

    return { items, page: command.page, limit: command.limit, total: page.total };
  }
}
