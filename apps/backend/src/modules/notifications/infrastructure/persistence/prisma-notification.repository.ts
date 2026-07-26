import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { NotificationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { Notification } from '../../domain/entities/notification.entity';
import {
  ListNotificationsOptions,
  NotificationPage,
  NotificationRepository,
} from '../../domain/repositories/notification.repository';
import { NotificationPrismaMapper } from './notification.prisma-mapper';

/**
 * Injects `PrismaContext` (the standard tenant-scoped client) - `Notification`
 * is deliberately NOT in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`
 * (Phase 9 decision item 13, TENANCY.md), so `withTenantScoping` is a
 * verified no-op passthrough for it. Safe because every query here is scoped
 * by the caller's own verified `userId` (`FavoriteRestaurantRepository`'s
 * identical precedent).
 */
@Injectable()
export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async save(notification: Notification): Promise<void> {
    const data = NotificationPrismaMapper.toPersistence(notification);
    await this.prismaContext.client.notification.upsert({
      where: { id: data.id },
      create: data,
      update: data,
    });
  }

  async findById(id: NotificationId): Promise<Notification | null> {
    const row = await this.prismaContext.client.notification.findUnique({
      where: { id: id.value },
    });
    return row ? NotificationPrismaMapper.toDomain(row) : null;
  }

  async listByUser(
    userId: UserId,
    page: number,
    limit: number,
    options: ListNotificationsOptions,
  ): Promise<NotificationPage> {
    const where = {
      userId: userId.value,
      ...(options.unreadOnly ? { read: false } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prismaContext.client.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.notification.count({ where }),
    ]);

    return { items: rows.map((row) => NotificationPrismaMapper.toDomain(row)), total };
  }

  async markAllReadByUser(userId: UserId, at: Date): Promise<void> {
    await this.prismaContext.client.notification.updateMany({
      where: { userId: userId.value, read: false },
      data: { read: true, readAt: at, updatedAt: at },
    });
  }

  async countUnreadByUser(userId: UserId): Promise<number> {
    return this.prismaContext.client.notification.count({
      where: { userId: userId.value, read: false },
    });
  }
}
