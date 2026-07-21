import { DomainEvent } from '@shared/domain/base/domain-event.base';

export interface ReservationEventPayload {
  correlationId?: string;
}

/**
 * Phase 7 decision note item 10: a real domain event class, not audit-only -
 * unlike Move Table/Status Management's audit-only precedent (which applied
 * because those actions had no consumers), `ReservationCreated` already has
 * named consumers in EVENTS.md/DOMAIN_MODEL.md (Analytics, Notifications,
 * WebSocket per Phase 8/9/14).
 */
export class ReservationCreatedEvent extends DomainEvent {
  public readonly eventName = 'ReservationCreated';

  constructor(
    eventId: string,
    public readonly payload: ReservationEventPayload & {
      reservationId: string;
      restaurantId: string;
      branchId: string;
      tableId: string;
      userId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}
