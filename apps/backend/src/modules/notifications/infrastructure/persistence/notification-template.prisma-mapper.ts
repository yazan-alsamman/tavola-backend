import { NotificationTemplate as PrismaNotificationTemplateRow } from '@prisma/client';
import {
  NotificationTemplate,
  NotificationTemplateProps,
} from '../../domain/entities/notification-template.entity';
import { NotificationChannel } from '../../domain/enums/notification.enums';

export type NotificationTemplateRow = PrismaNotificationTemplateRow;

export class NotificationTemplatePrismaMapper {
  static toDomain(row: NotificationTemplateRow): NotificationTemplate {
    if (!Object.values(NotificationChannel).includes(row.channel as NotificationChannel)) {
      throw new Error(`Unknown notification template channel persisted: ${row.channel}`);
    }

    const props: NotificationTemplateProps = {
      id: row.id,
      eventType: row.eventType,
      language: row.language,
      channel: row.channel as NotificationChannel,
      title: row.title,
      body: row.body,
      isDefault: row.isDefault,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    return NotificationTemplate.reconstitute(props);
  }
}
