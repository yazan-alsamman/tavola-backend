import { Inject, Injectable } from '@nestjs/common';
import {
  NotificationBroadcastHistoryQuery,
  NotificationBroadcastHistoryRow,
  PlatformAdminNotificationStatsReaderPort,
  PLATFORM_ADMIN_NOTIFICATION_STATS_READER,
} from '../ports/platform-admin-notification-stats-reader.port';

export interface ListNotificationBroadcastsResult {
  items: NotificationBroadcastHistoryRow[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Backs `GET /platform-admin/notifications` — the broadcast history the
 * Platform Owner console needs in order to answer "did that broadcast
 * actually go out?" after `POST /platform-admin/notifications/broadcast`
 * returns 202 Accepted.
 *
 * That 202 is precisely why this endpoint has to exist: the broadcast is
 * queued, not delivered, so the response cannot report an outcome. Without a
 * history endpoint a console has no way to learn the outcome at all, and the
 * only remaining option is to invent a status client-side - which would be
 * fiction, since the real one is written asynchronously by
 * `NotificationBroadcastFanoutProcessor` minutes later.
 *
 * Everything returned is persisted aggregate state. Read-only, so both
 * Platform tiers may call it (ADR-034 §11 restricts `PlatformSupport` from
 * mutations only) - even though authoring a broadcast is PlatformAdmin-only.
 */
@Injectable()
export class PlatformAdminListNotificationBroadcastsUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_NOTIFICATION_STATS_READER)
    private readonly reader: PlatformAdminNotificationStatsReaderPort,
  ) {}

  async execute(
    query: NotificationBroadcastHistoryQuery,
  ): Promise<ListNotificationBroadcastsResult> {
    const { items, total } = await this.reader.listBroadcasts(query);
    return { items, total, page: query.page, limit: query.limit };
  }
}
