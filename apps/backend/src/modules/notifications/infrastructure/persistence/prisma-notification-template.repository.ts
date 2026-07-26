import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { NotificationChannel } from '../../domain/enums/notification.enums';
import { NotificationTemplate } from '../../domain/entities/notification-template.entity';
import { NotificationTemplateRepository } from '../../domain/repositories/notification-template.repository';
import { NotificationTemplatePrismaMapper } from './notification-template.prisma-mapper';

/**
 * Platform-global reference data (Phase 9 decision item 15) - no tenant
 * scoping concept applies at all; injects `PrismaContext` only for
 * consistency with every other repository in this codebase.
 */
@Injectable()
export class PrismaNotificationTemplateRepository implements NotificationTemplateRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findExact(
    eventType: string,
    language: string,
    channel: NotificationChannel,
  ): Promise<NotificationTemplate | null> {
    const row = await this.prismaContext.client.notificationTemplate.findUnique({
      where: { eventType_language_channel: { eventType, language, channel } },
    });
    return row ? NotificationTemplatePrismaMapper.toDomain(row) : null;
  }

  async findDefault(
    eventType: string,
    channel: NotificationChannel,
  ): Promise<NotificationTemplate | null> {
    const row = await this.prismaContext.client.notificationTemplate.findFirst({
      where: { eventType, channel, isDefault: true },
    });
    return row ? NotificationTemplatePrismaMapper.toDomain(row) : null;
  }
}
