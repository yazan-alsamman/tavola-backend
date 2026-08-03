import { DomainEvent } from '@shared/domain/base/domain-event.base';

/**
 * Phase 11 (Offers, architecture frozen 2026-07-28) - the 5 frozen event
 * classes (EVENTS.md's "Offer Events" section). Neither on the Phase 8
 * realtime allow-list nor the Phase 9 NotificationDispatcher allow-list -
 * both remain fail-closed/default-deny for every Offer event (Phase 8/9
 * impact: none), exactly like Review events. No customer PII in any
 * payload - Offers carry no customer data.
 */
export class OfferCreatedEvent extends DomainEvent {
  public readonly eventName = 'OfferCreated';

  constructor(
    eventId: string,
    public readonly payload: {
      offerId: string;
      restaurantId: string;
      createdByUserId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/** Reachable only while `status = Draft` - `Published`/`Expired` Offers are immutable. */
export class OfferUpdatedEvent extends DomainEvent {
  public readonly eventName = 'OfferUpdated';

  constructor(
    eventId: string,
    public readonly payload: {
      offerId: string;
      restaurantId: string;
      updatedByUserId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/** `Draft -> Published` only. */
export class OfferPublishedEvent extends DomainEvent {
  public readonly eventName = 'OfferPublished';

  constructor(
    eventId: string,
    public readonly payload: {
      offerId: string;
      restaurantId: string;
      publishedByUserId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * `Published -> Expired` only, via the BullMQ-scheduled, CAS-guarded
 * expiration job (`WHERE status = 'Published' AND deleted_at IS NULL`) - no
 * authenticated actor.
 */
export class OfferExpiredEvent extends DomainEvent {
  public readonly eventName = 'OfferExpired';

  constructor(
    eventId: string,
    public readonly payload: {
      offerId: string;
      restaurantId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/** Soft delete, reachable by Owner/Admin from any state (Draft/Published/Expired). */
export class OfferDeletedEvent extends DomainEvent {
  public readonly eventName = 'OfferDeleted';

  constructor(
    eventId: string,
    public readonly payload: {
      offerId: string;
      restaurantId: string;
      deletedByUserId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}
