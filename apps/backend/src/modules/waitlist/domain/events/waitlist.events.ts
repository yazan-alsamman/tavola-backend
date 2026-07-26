import { DomainEvent } from '@shared/domain/base/domain-event.base';

export interface WaitlistEventPayload {
  correlationId?: string;
}

/**
 * Phase 7.5 (Reservation Waitlist, ADR-019, architecture frozen 2026-07-24) -
 * one of the 5 frozen event classes (freeze item 15). `createdBy` mirrors
 * `ReservationCreatedEvent`'s own always-populated pattern (Join always has a
 * real Customer or Employee actor, never System - freeze item 8: "System...
 * may not Join").
 */
export class WaitlistEntryCreatedEvent extends DomainEvent {
  public readonly eventName = 'WaitlistEntryCreated';

  constructor(
    eventId: string,
    public readonly payload: WaitlistEventPayload & {
      entryId: string;
      restaurantId: string;
      branchId: string;
      userId: string | null;
      reservationGuestId: string | null;
      createdBy: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Reserved for Phase 7.6 (Operational Signals) - no Phase 7.5 use case
 * publishes this event (freeze item 17 excludes notification delivery from
 * this phase's scope). Exists now so Phase 7.6 has a real event class to
 * consume, per the same "already-named consumers" precedent
 * `ReservationCreatedEvent`'s own doc comment cites.
 */
export class WaitlistEntryNotifiedEvent extends DomainEvent {
  public readonly eventName = 'WaitlistEntryNotified';

  constructor(
    eventId: string,
    public readonly payload: WaitlistEventPayload & {
      entryId: string;
      restaurantId: string;
      branchId: string;
      notifiedAt: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Mirrors `ReservationApprovedEvent`'s `approvedBy: string | null` +
 * `automatic: boolean`-equivalent pattern (not `ReservationCreatedEvent`'s
 * always-populated shape) - `promotedBy` is the Employee id for manual
 * promotion, `null` for automatic/System promotion (Phase 7.5 freeze item
 * 16). Successful conversion also emits `ReservationCreatedEvent` with
 * `source: WaitlistConversion` (freeze item 15: two aggregates, two events).
 */
export class WaitlistEntryPromotedEvent extends DomainEvent {
  public readonly eventName = 'WaitlistEntryPromoted';

  constructor(
    eventId: string,
    public readonly payload: WaitlistEventPayload & {
      entryId: string;
      restaurantId: string;
      branchId: string;
      convertedReservationId: string;
      promotedBy: string | null;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * The BullMQ-driven expiration job has no authenticated HTTP actor at all -
 * audited with `actorType: 'System'`, `actorId: null`, exactly like
 * `ReservationExpiredEvent`'s own precedent.
 */
export class WaitlistEntryExpiredEvent extends DomainEvent {
  public readonly eventName = 'WaitlistEntryExpired';

  constructor(
    eventId: string,
    public readonly payload: WaitlistEventPayload & {
      entryId: string;
      restaurantId: string;
      branchId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Reachable by both the entry's own Customer and a branch-scoped Employee
 * (freeze item 8) - `cancelledBy` carries whichever actor's id, mirroring
 * `ReservationCancelledEvent`'s own always-populated `cancelledBy` (no
 * system-initiated cancel path exists in Phase 7.5). `cancelledByActorType`
 * is carried explicitly (rather than inferred from the entry's own
 * `userId`/`reservationGuestId`, which reflects the entry's OWNER, not
 * necessarily who performed this Cancel - an Employee may cancel a
 * User-owned entry) so `AuditingEventPublisher` can attribute precisely per
 * freeze item 16, without guessing.
 */
export class WaitlistEntryCancelledEvent extends DomainEvent {
  public readonly eventName = 'WaitlistEntryCancelled';

  constructor(
    eventId: string,
    public readonly payload: WaitlistEventPayload & {
      entryId: string;
      restaurantId: string;
      branchId: string;
      cancelledBy: string;
      cancelledByActorType: 'User' | 'Employee';
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}
