import { DomainEvent } from '@shared/domain/base/domain-event.base';

/**
 * Phase 19.9 (ADR-037) — published alongside the existing `NotificationCreatedEvent`
 * whenever a Platform Admin sends a notification directly to one Customer.
 * `NotificationCreatedEvent`'s own audit branch only ever records
 * `actorType: 'System'` (it is reused verbatim from the event-dispatched
 * path, where there genuinely is no human actor); this event exists purely
 * so `AuditingEventPublisher` can write a second, properly actor-attributed
 * (`PlatformAdmin`) audit row for the send action itself, mirroring
 * `CustomerAcquisitionManuallyRecordedEvent`'s existing precedent.
 */
export class PlatformAdminNotificationSentEvent extends DomainEvent {
  public readonly eventName = 'PlatformAdminNotificationSent';

  constructor(
    eventId: string,
    public readonly payload: {
      adminId: string;
      notificationId: string;
      targetUserId: string;
      correlationId?: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}
