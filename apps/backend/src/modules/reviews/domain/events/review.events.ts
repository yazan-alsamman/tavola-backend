import { DomainEvent } from '@shared/domain/base/domain-event.base';

/**
 * Phase 10 (Reviews, architecture frozen 2026-07-26) - the 3 frozen event
 * classes (EVENTS.md's "Review Events" section). `ReviewUpdated` is
 * deliberately absent - Reviews are immutable after creation (no edit
 * endpoint), so no event class is ever needed for it.
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
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * `deletedBy` is always a `User.id` - either the owning Customer or an
 * Organization Owner/Admin (both attribute as `actorType: 'User'`, since
 * `AuditActorType` has no `OrganizationMember` variant and Owner/Admin
 * actions have always logged as `'User'` platform-wide). Employees never
 * delete Reviews in Phase 10, so there is no `Employee` attribution path for
 * this event.
 */
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
