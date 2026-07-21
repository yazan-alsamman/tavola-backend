import { DomainEvent } from '@shared/domain/base/domain-event.base';

/**
 * `organizationId` is included here (unlike the row itself, which carries no
 * such column) because the audit trail needs it and the event is the point
 * where the already-tenant-verified value is still in hand - mirrors
 * RestaurantEventPayload's shape for consistency across the codebase's
 * audit-mapping convention (AuditingEventPublisher.toAuditEntry).
 */
export interface BranchEventPayload {
  branchId: string;
  restaurantId: string;
  organizationId: string;
  actorId: string;
  correlationId?: string;
}

export class BranchCreatedEvent extends DomainEvent {
  public readonly eventName = 'BranchCreated';
  public readonly payload: BranchEventPayload;

  constructor(
    eventId: string,
    payload: BranchEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class BranchUpdatedEvent extends DomainEvent {
  public readonly eventName = 'BranchUpdated';
  public readonly payload: BranchEventPayload;

  constructor(
    eventId: string,
    payload: BranchEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class BranchDeletedEvent extends DomainEvent {
  public readonly eventName = 'BranchDeleted';
  public readonly payload: BranchEventPayload;

  constructor(
    eventId: string,
    payload: BranchEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}
