import { Entity } from '@shared/domain/base/entity.base';
import { NotificationChannel } from '../enums/notification.enums';
import { InvalidNotificationException } from '../exceptions/invalid-notification.exception';

export interface NotificationTemplateProps {
  id: string;
  eventType: string;
  language: string;
  channel: NotificationChannel;
  title: string;
  body: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Platform-global reference data (Phase 9 decision item 15) - no
 * restaurant-specific override, no versioning. Unique on
 * `(eventType, language, channel)`; `isDefault` marks the fallback row
 * `NotificationTemplateRepository.resolve` falls back to when no template
 * exists for the recipient's resolved `User.language` (LOCALIZATION.md).
 * Seed/content data, never mutated by application code in v1 - only
 * `reconstitute`/read access is exercised outside seeding.
 */
export class NotificationTemplate extends Entity<NotificationTemplateProps> {
  private constructor(props: NotificationTemplateProps) {
    super(props);
  }

  static create(props: NotificationTemplateProps): NotificationTemplate {
    if (props.eventType.trim().length === 0) {
      throw new InvalidNotificationException('NotificationTemplate must have an eventType.');
    }
    if (props.language.trim().length === 0) {
      throw new InvalidNotificationException('NotificationTemplate must have a language.');
    }
    if (props.title.trim().length === 0) {
      throw new InvalidNotificationException('NotificationTemplate must have a non-empty title.');
    }
    if (props.body.trim().length === 0) {
      throw new InvalidNotificationException('NotificationTemplate must have a non-empty body.');
    }
    return new NotificationTemplate({ ...props });
  }

  static reconstitute(props: NotificationTemplateProps): NotificationTemplate {
    return new NotificationTemplate({ ...props });
  }

  get eventType(): string {
    return this.props.eventType;
  }

  get language(): string {
    return this.props.language;
  }

  get channel(): NotificationChannel {
    return this.props.channel;
  }

  get title(): string {
    return this.props.title;
  }

  get body(): string {
    return this.props.body;
  }

  get isDefault(): boolean {
    return this.props.isDefault;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  toProps(): Readonly<NotificationTemplateProps> {
    return { ...this.props };
  }
}
