import { Notification as PrismaNotificationRow, Prisma } from '@prisma/client';
import { Notification, NotificationProps } from '../../domain/entities/notification.entity';
import { NotificationPushStatus } from '../../domain/enums/notification.enums';

export type NotificationRow = PrismaNotificationRow;

export class NotificationPrismaMapper {
  static toDomain(row: NotificationRow): Notification {
    if (!Object.values(NotificationPushStatus).includes(row.pushStatus as NotificationPushStatus)) {
      throw new Error(`Unknown notification push status persisted: ${row.pushStatus}`);
    }

    const props: NotificationProps = {
      id: row.id,
      userId: row.userId,
      type: row.type,
      templateId: row.templateId,
      broadcastId: row.broadcastId,
      title: row.title,
      body: row.body,
      data: (row.data as Record<string, unknown> | null) ?? null,
      read: row.read,
      readAt: row.readAt,
      pushStatus: row.pushStatus as NotificationPushStatus,
      pushSentAt: row.pushSentAt,
      pushFailedAt: row.pushFailedAt,
      pushFailureReason: row.pushFailureReason,
      pushIdempotencyKey: row.pushIdempotencyKey,
      pushProviderMessageId: row.pushProviderMessageId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    return Notification.reconstitute(props);
  }

  static toPersistence(notification: Notification): Prisma.NotificationUncheckedCreateInput {
    const props = notification.toProps();
    return {
      id: props.id,
      userId: props.userId,
      type: props.type,
      templateId: props.templateId,
      broadcastId: props.broadcastId,
      title: props.title,
      body: props.body,
      data: props.data === null ? Prisma.JsonNull : (props.data as Prisma.InputJsonValue),
      read: props.read,
      readAt: props.readAt,
      pushStatus: props.pushStatus,
      pushSentAt: props.pushSentAt,
      pushFailedAt: props.pushFailedAt,
      pushFailureReason: props.pushFailureReason,
      pushIdempotencyKey: props.pushIdempotencyKey,
      pushProviderMessageId: props.pushProviderMessageId,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    };
  }
}
