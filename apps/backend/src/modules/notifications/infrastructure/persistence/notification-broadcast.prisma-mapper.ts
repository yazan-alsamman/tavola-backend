import { NotificationBroadcast as PrismaNotificationBroadcastRow, Prisma } from '@prisma/client';
import {
  NotificationBroadcast,
  NotificationBroadcastProps,
} from '../../domain/entities/notification-broadcast.entity';
import {
  NotificationBroadcastSenderType,
  NotificationBroadcastStatus,
} from '../../domain/enums/notification-broadcast.enums';

export type NotificationBroadcastRow = PrismaNotificationBroadcastRow;

export class NotificationBroadcastPrismaMapper {
  static toDomain(row: NotificationBroadcastRow): NotificationBroadcast {
    if (
      !Object.values(NotificationBroadcastSenderType).includes(
        row.senderType as NotificationBroadcastSenderType,
      )
    ) {
      throw new Error(`Unknown notification broadcast sender type persisted: ${row.senderType}`);
    }
    if (
      !Object.values(NotificationBroadcastStatus).includes(
        row.status as NotificationBroadcastStatus,
      )
    ) {
      throw new Error(`Unknown notification broadcast status persisted: ${row.status}`);
    }

    const props: NotificationBroadcastProps = {
      id: row.id,
      senderType: row.senderType as NotificationBroadcastSenderType,
      senderId: row.senderId,
      organizationId: row.organizationId,
      title: row.title,
      body: row.body,
      totalRecipients: row.totalRecipients,
      processedCount: row.processedCount,
      succeededCount: row.succeededCount,
      failedCount: row.failedCount,
      status: row.status as NotificationBroadcastStatus,
      lastProcessedUserId: row.lastProcessedUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    return NotificationBroadcast.reconstitute(props);
  }

  static toPersistence(
    broadcast: NotificationBroadcast,
  ): Prisma.NotificationBroadcastUncheckedCreateInput {
    const props = broadcast.toProps();
    return {
      id: props.id,
      senderType: props.senderType,
      senderId: props.senderId,
      organizationId: props.organizationId,
      title: props.title,
      body: props.body,
      totalRecipients: props.totalRecipients,
      processedCount: props.processedCount,
      succeededCount: props.succeededCount,
      failedCount: props.failedCount,
      status: props.status,
      lastProcessedUserId: props.lastProcessedUserId,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    };
  }
}
