import { DomainEvent } from '@shared/domain/base/domain-event.base';

/**
 * Phase 10 (Reviews) event classes (EVENTS.md's "Review Events" section),
 * plus ADR-045's re-rating pair: a review changes after creation only when
 * the restaurant reopens it and its guest rates again.
 */
export class ReviewCreatedEvent extends DomainEvent {
  public readonly eventName = 'ReviewCreated';

  constructor(
    eventId: string,
    public readonly payload: {
      reviewId: string;
      restaurantId: string;
      reservationId: string;
      userId: string;
      rating: number;
      /** Average of the three axes, or `rating` (ADR-045). */
      score: number;
      /** The visit's branch - who on staff hears about the review. */
      branchId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/** The guest rated again after the restaurant reopened the review (ADR-045). */
export class ReviewReratedEvent extends DomainEvent {
  public readonly eventName = 'ReviewRerated';

  constructor(
    eventId: string,
    public readonly payload: {
      reviewId: string;
      restaurantId: string;
      reservationId: string;
      userId: string;
      previousScore: number;
      score: number;
      branchId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/** The restaurant opened a review for its guest to rate again (ADR-045). */
export class ReviewReopenedEvent extends DomainEvent {
  public readonly eventName = 'ReviewReopened';

  constructor(
    eventId: string,
    public readonly payload: {
      reviewId: string;
      restaurantId: string;
      reservationId: string;
      reopenedBy: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/** `deletedBy` is the review's own guest - the only actor who may delete it (ADR-045). */
export class ReviewDeletedEvent extends DomainEvent {
  public readonly eventName = 'ReviewDeleted';

  constructor(
    eventId: string,
    public readonly payload: {
      reviewId: string;
      restaurantId: string;
      reservationId: string;
      deletedBy: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * `repliedByUserId` is always an Organization Owner/Admin's own `User.id` -
 * no Employee reply path exists in Phase 10, so there is no dual-actor-id
 * ambiguity to resolve here (unlike `TableMergedEvent`/
 * `ReservationCancelledEvent`, which need `TenantContextService.getActorType()`
 * to disambiguate a User-or-Employee actor).
 */
export class RestaurantRepliedToReviewEvent extends DomainEvent {
  public readonly eventName = 'RestaurantRepliedToReview';

  constructor(
    eventId: string,
    public readonly payload: {
      reviewId: string;
      restaurantId: string;
      repliedByUserId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}
