import { DomainEvent } from '@shared/domain/base/domain-event.base';

/**
 * `organizationId` is included here (unlike the row itself, which carries no
 * such column) because the audit trail needs it and the event is the point
 * where the already-tenant-verified value is still in hand - mirrors
 * `BranchEventPayload`'s shape for consistency across the codebase's
 * audit-mapping convention (`AuditingEventPublisher.toAuditEntry`).
 */
export interface TableEventPayload {
  tableId: string;
  branchId: string;
  floorPlanId: string;
  organizationId: string;
  actorId: string;
  correlationId?: string;
}

export class TableCreatedEvent extends DomainEvent {
  public readonly eventName = 'TableCreated';
  public readonly payload: TableEventPayload;

  constructor(
    eventId: string,
    payload: TableEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class TableUpdatedEvent extends DomainEvent {
  public readonly eventName = 'TableUpdated';
  public readonly payload: TableEventPayload;

  constructor(
    eventId: string,
    payload: TableEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class TableDeletedEvent extends DomainEvent {
  public readonly eventName = 'TableDeleted';
  public readonly payload: TableEventPayload;

  constructor(
    eventId: string,
    payload: TableEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}
