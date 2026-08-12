import { NotificationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { Notification } from '../entities/notification.entity';

export interface NotificationPage {
  items: Notification[];
  total: number;
}

export interface ListNotificationsOptions {
  unreadOnly: boolean;
}

/**
 * `Notification` is `userId`-owned only (Phase 9 decision item 2/13) - every
 * method here is scoped by the caller's own verified `userId`, never by
 * `organizationId` (see this entity's own doc comment and TENANCY.md).
 */
export interface NotificationRepository {
  /** Upsert-by-id - used both for the initial `create()` insert and every subsequent state-transition write. */
  save(notification: Notification): Promise<void>;

  /**
   * Phase 19.9 (ADR-037) — bulk insert for `NotificationBroadcastFanoutProcessor`'s
   * batches only. `skipDuplicates` relies on the `[broadcastId, userId]`
   * unique index so a retried batch never double-inserts; the returned count
   * is how many rows were genuinely new (used to advance
   * `NotificationBroadcast.succeededCount`/`failedCount`). Never used for the
   * single-entity `create()` path — CODING_STANDARDS.md's N+1 rule is why
   * this exists as its own method rather than a per-row `save()` loop.
   */
  saveMany(notifications: readonly Notification[]): Promise<{ insertedCount: number }>;

  findById(id: NotificationId): Promise<Notification | null>;

  /** Paginated, ordered newest-first (API_GUIDELINES.md's Notification Endpoints). */
  listByUser(
    userId: UserId,
    page: number,
    limit: number,
    options: ListNotificationsOptions,
  ): Promise<NotificationPage>;

  /**
   * Bulk `read: false -> true` for every currently-unread notification
   * belonging to `userId` - a direct `UPDATE ... WHERE user_id = ? AND read
   * = false`, not a load-mutate-save loop per row (CODING_STANDARDS.md's
   * N+1 rule).
   */
  markAllReadByUser(userId: UserId, at: Date): Promise<void>;

  /** A direct `COUNT(*) WHERE user_id = ? AND read = false` - backs the unread-count badge endpoint. */
  countUnreadByUser(userId: UserId): Promise<number>;
}

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');
