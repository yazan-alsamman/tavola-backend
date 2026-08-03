import { DomainEvent } from '@shared/domain/base/domain-event.base';

/**
 * Phase 12 (Subscriptions, architecture frozen 2026-07-28, ADR-027 §13) -
 * the 6 frozen event classes (EVENTS.md's "Subscription Events" section).
 * No `SubscriptionRenewed`/`Upgraded`/`Downgraded` (a plan change is one
 * event regardless of direction) and no `PlanCreated`/`PlanUpdated` (plans
 * are seed-managed, D2). Neither on the Phase 8 realtime allow-list nor the
 * Phase 9 NotificationDispatcher allow-list (D29/D30) - no PII in any
 * payload.
 *
 * Implementation-time correction: the 5 PlatformAdmin-initiated events carry
 * `actorId` (the PlatformAdmin's `User.id`) - the originally-frozen ADR-027
 * shape omitted it, but every other event class in this codebase (e.g.
 * `RestaurantCreatedEvent.payload.actorId`, `OfferCreatedEvent.payload.createdByUserId`)
 * carries actor attribution in its payload specifically so
 * `AuditingEventPublisher` can derive the audit entry from the event alone,
 * without a second, parallel `auditLogWriter.record()` call in the use case.
 * `actorId` is not PII (it is the acting Platform Admin's own id, already
 * present in every comparable event platform-wide) - not a scope expansion
 * of D27's "no PII" rule, a mechanical consistency fix.
 */
export class SubscriptionAssignedEvent extends DomainEvent {
  public readonly eventName = 'SubscriptionAssigned';

  constructor(
    eventId: string,
    public readonly payload: {
      subscriptionId: string;
      organizationId: string;
      planId: string;
      actorId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class SubscriptionPlanChangedEvent extends DomainEvent {
  public readonly eventName = 'SubscriptionPlanChanged';

  constructor(
    eventId: string,
    public readonly payload: {
      subscriptionId: string;
      organizationId: string;
      oldPlanId: string;
      newPlanId: string;
      actorId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class SubscriptionSuspendedEvent extends DomainEvent {
  public readonly eventName = 'SubscriptionSuspended';

  constructor(
    eventId: string,
    public readonly payload: { subscriptionId: string; organizationId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class SubscriptionReactivatedEvent extends DomainEvent {
  public readonly eventName = 'SubscriptionReactivated';

  constructor(
    eventId: string,
    public readonly payload: { subscriptionId: string; organizationId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class SubscriptionCancelledEvent extends DomainEvent {
  public readonly eventName = 'SubscriptionCancelled';

  constructor(
    eventId: string,
    public readonly payload: { subscriptionId: string; organizationId: string; actorId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/** System-initiated only (BullMQ-scheduled, CAS-guarded on `endsAt`) - mirrors `OfferExpiredEvent`. */
export class SubscriptionExpiredEvent extends DomainEvent {
  public readonly eventName = 'SubscriptionExpired';

  constructor(
    eventId: string,
    public readonly payload: { subscriptionId: string; organizationId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}
