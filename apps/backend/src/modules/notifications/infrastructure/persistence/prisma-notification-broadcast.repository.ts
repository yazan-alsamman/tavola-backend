import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { NotificationBroadcastId } from '@shared/domain/value-objects/identifiers.vo';
import { NotificationBroadcast } from '../../domain/entities/notification-broadcast.entity';
import { NotificationBroadcastRepository } from '../../domain/repositories/notification-broadcast.repository';
import { NotificationBroadcastPrismaMapper } from './notification-broadcast.prisma-mapper';

/**
 * Injects `PrismaContext` (the standard tenant-scoped client) - like
 * `Notification`, `NotificationBroadcast` is deliberately NOT in
 * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (ADR-037 Decision #4:
 * the audience it drives is global, and its own `organizationId` column is
 * audit/traceability only), so `withTenantScoping` is a verified no-op
 * passthrough here too. Safe because every query is scoped by the caller's
 * own verified broadcast `id`.
 */
@Injectable()
export class PrismaNotificationBroadcastRepository implements NotificationBroadcastRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async save(broadcast: NotificationBroadcast): Promise<void> {
    const data = NotificationBroadcastPrismaMapper.toPersistence(broadcast);
    await this.prismaContext.client.notificationBroadcast.upsert({
      where: { id: data.id },
      create: data,
      update: data,
    });
  }

  async findById(id: NotificationBroadcastId): Promise<NotificationBroadcast | null> {
    const row = await this.prismaContext.client.notificationBroadcast.findUnique({
      where: { id: id.value },
    });
    return row ? NotificationBroadcastPrismaMapper.toDomain(row) : null;
  }
}
