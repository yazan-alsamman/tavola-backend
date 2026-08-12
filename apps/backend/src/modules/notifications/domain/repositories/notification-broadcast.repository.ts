import { NotificationBroadcastId } from '@shared/domain/value-objects/identifiers.vo';
import { NotificationBroadcast } from '../entities/notification-broadcast.entity';

/**
 * `NotificationBroadcast` (Phase 19.9, ADR-037) is a small, single-owner
 * state-machine row - no listing/pagination method exists in v1 (no admin UI
 * to browse past broadcasts was authorized; `save`/`findById` are the only
 * operations `CreateNotificationBroadcastService` and
 * `NotificationBroadcastFanoutProcessor` need).
 */
export interface NotificationBroadcastRepository {
  /** Upsert-by-id - used for the initial `create()` insert and every subsequent counter/status write. */
  save(broadcast: NotificationBroadcast): Promise<void>;

  findById(id: NotificationBroadcastId): Promise<NotificationBroadcast | null>;
}

export const NOTIFICATION_BROADCAST_REPOSITORY = Symbol('NOTIFICATION_BROADCAST_REPOSITORY');
