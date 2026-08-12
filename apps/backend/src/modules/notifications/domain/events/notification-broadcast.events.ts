import { DomainEvent } from '@shared/domain/base/domain-event.base';

interface NotificationBroadcastRequestedPayload {
  broadcastId: string;
  title: string;
  totalRecipients: number | null;
  correlationId?: string;
}

/**
 * Phase 19.9 (ADR-037) — published once, synchronously, when a Platform
 * Admin's broadcast-to-all-eligible-Customers HTTP request completes
 * (`CreateNotificationBroadcastService`), before the BullMQ fan-out job even
 * runs. One audit row per broadcast action, not one per recipient
 * (ADR-037 Decision #6) - `AuditingEventPublisher` maps this to
 * `actorType: 'PlatformAdmin'`, mirroring
 * `CustomerAcquisitionManuallyRecordedEvent`'s existing precedent.
 */
export class PlatformAdminNotificationBroadcastRequestedEvent extends DomainEvent {
  public readonly eventName = 'PlatformAdminNotificationBroadcastRequested';

  constructor(
    eventId: string,
    public readonly payload: NotificationBroadcastRequestedPayload & { adminId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Phase 19.9 (ADR-037) — the Restaurant Owner equivalent of
 * `PlatformAdminNotificationBroadcastRequestedEvent`. `restaurantId`/
 * `organizationId` are audit/traceability only (which restaurant's Owner
 * triggered it) - per ADR-037 Decision #4/#8 the audience itself is global,
 * never scoped by either.
 */
export class RestaurantOwnerNotificationBroadcastRequestedEvent extends DomainEvent {
  public readonly eventName = 'RestaurantOwnerNotificationBroadcastRequested';

  constructor(
    eventId: string,
    public readonly payload: NotificationBroadcastRequestedPayload & {
      ownerId: string;
      organizationId: string;
      restaurantId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}
