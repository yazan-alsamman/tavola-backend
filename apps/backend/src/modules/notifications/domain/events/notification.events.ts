import { DomainEvent } from '@shared/domain/base/domain-event.base';

export interface NotificationEventPayload {
  correlationId?: string;
}

/**
 * Phase 9 (architecture frozen 2026-07-25) - the only Notification-specific
 * domain event v1 defines (EVENTS.md's "Notification Events" section).
 * Published once, immediately after the durable `Notification` row is
 * persisted, by `NotifyingEventPublisher`. Consumed by both
 * `AuditingEventPublisher` (per the usual convention) and, when
 * `reservationId` is set, `RealtimeEventPublisher`'s `reservation:{id}` room
 * broadcast (payload minimized there to `{ notificationId, type }` only -
 * never `title`/`body`, per the frozen PII policy). `reservationId` is
 * `null` for a Waitlist-sourced notification (`WaitlistEntryPromoted`), which
 * never broadcasts a customer-room realtime hint in v1 (no
 * `waitlist:{id}`-equivalent customer room exists).
 */
export class NotificationCreatedEvent extends DomainEvent {
  public readonly eventName = 'NotificationCreated';

  constructor(
    eventId: string,
    public readonly payload: NotificationEventPayload & {
      notificationId: string;
      userId: string;
      type: string;
      reservationId: string | null;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}
