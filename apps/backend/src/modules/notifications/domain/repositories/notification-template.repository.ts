import { NotificationChannel } from '../enums/notification.enums';
import { NotificationTemplate } from '../entities/notification-template.entity';

/**
 * Platform-global template lookup (Phase 9 decision item 15). Deliberately
 * two narrow methods rather than one "resolve with fallback" method - the
 * fallback-to-`isDefault` business rule (LOCALIZATION.md's "Notification
 * Content" section) is application-layer orchestration
 * (`NotificationDispatcher`), not a repository concern; this port only
 * exposes the two underlying reads.
 */
export interface NotificationTemplateRepository {
  findExact(
    eventType: string,
    language: string,
    channel: NotificationChannel,
  ): Promise<NotificationTemplate | null>;

  findDefault(
    eventType: string,
    channel: NotificationChannel,
  ): Promise<NotificationTemplate | null>;
}

export const NOTIFICATION_TEMPLATE_REPOSITORY = Symbol('NOTIFICATION_TEMPLATE_REPOSITORY');
