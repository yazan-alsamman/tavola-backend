import { DomainEvent } from '@shared/domain/base/domain-event.base';

export interface RestaurantEventPayload {
  restaurantId: string;
  organizationId: string;
  actorId: string;
  correlationId?: string;
}

export class RestaurantCreatedEvent extends DomainEvent {
  public readonly eventName = 'RestaurantCreated';
  public readonly payload: RestaurantEventPayload;

  constructor(
    eventId: string,
    payload: RestaurantEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class RestaurantUpdatedEvent extends DomainEvent {
  public readonly eventName = 'RestaurantUpdated';
  public readonly payload: RestaurantEventPayload;

  constructor(
    eventId: string,
    payload: RestaurantEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class RestaurantDeletedEvent extends DomainEvent {
  public readonly eventName = 'RestaurantDeleted';
  public readonly payload: RestaurantEventPayload;

  constructor(
    eventId: string,
    payload: RestaurantEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class RestaurantActivatedEvent extends DomainEvent {
  public readonly eventName = 'RestaurantActivated';
  public readonly payload: RestaurantEventPayload;

  constructor(
    eventId: string,
    payload: RestaurantEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class RestaurantSuspendedEvent extends DomainEvent {
  public readonly eventName = 'RestaurantSuspended';
  public readonly payload: RestaurantEventPayload;

  constructor(
    eventId: string,
    payload: RestaurantEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

/** ADR-034 §3 (Phase 19.1) - no actor, Owner/Admin or PlatformAdmin, has ever had a restore capability before this. */
export class RestaurantRestoredEvent extends DomainEvent {
  public readonly eventName = 'RestaurantRestored';
  public readonly payload: RestaurantEventPayload;

  constructor(
    eventId: string,
    payload: RestaurantEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}
