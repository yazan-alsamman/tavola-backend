import { DomainEvent } from '@shared/domain/base/domain-event.base';
import { TableStatus } from '../enums/table.enums';

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

/**
 * Phase 8 (WebSocket, architecture frozen 2026-07-24) §5 — narrow scope: only
 * `ChangeTableStatusUseCase`'s manual `POST /tables/:tableId/status` transition
 * publishes this event. It must NOT be emitted from `Table.reserve()`/
 * `Table.release()` or any Reservation-owned status change (Approve,
 * auto-Approve, WaitlistConversion auto-Approve, Cancel Approved, Complete,
 * NoShow, Reschedule) — those remain represented solely by Reservation
 * lifecycle events; clients reconcile Table state via REST. Supersedes the
 * prior "Status Management decision #7" (audit-log-only, no domain event)
 * precedent for this one action only — `table.status_changed` auditing now
 * flows through `AuditingEventPublisher` like every other domain event.
 */
export interface TableStatusChangedEventPayload {
  tableId: string;
  branchId: string;
  floorPlanId: string;
  organizationId: string;
  fromStatus: TableStatus;
  toStatus: TableStatus;
  actorId: string;
  correlationId?: string;
}

export class TableStatusChangedEvent extends DomainEvent {
  public readonly eventName = 'TableStatusChanged';
  public readonly payload: TableStatusChangedEventPayload;

  constructor(
    eventId: string,
    payload: TableStatusChangedEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

/**
 * Phase 8 (WebSocket, architecture frozen 2026-07-24) §6 — for the existing
 * Move Table Domain Action (`MoveTableUseCase`, `POST /tables/:tableId/move`)
 * only; Merge/Split remain untouched. Supersedes the prior "Phase 6.2 decision
 * #7" (audit-log-only, no domain event) precedent for this one action —
 * `table.moved` auditing now flows through `AuditingEventPublisher` like
 * every other domain event.
 */
export interface TableMovedEventPayload {
  tableId: string;
  branchId: string;
  organizationId: string;
  oldFloorPlanId: string;
  newFloorPlanId: string;
  actorId: string;
  correlationId?: string;
}

export class TableMovedEvent extends DomainEvent {
  public readonly eventName = 'TableMoved';
  public readonly payload: TableMovedEventPayload;

  constructor(
    eventId: string,
    payload: TableMovedEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

/**
 * Phase 6 (Merge/Split Tables, architecture frozen 2026-07-25, ADR-026
 * decision #10) - published by `MergeTablesUseCase` only, after the
 * merge transaction commits. Minimized payload: `memberTableIds` includes
 * the primary (matches `TableMergeService.selectPrimary`'s own input set -
 * "every table involved in this merge", not merely "the secondaries").
 * `effectiveCapacity` is the derived `SUM(member capacities)` at merge time
 * (ADR-026 decision #4) - a point-in-time snapshot, not re-derived later.
 * Audited (`table.merged`) and Phase 8 allow-listed to the existing staff
 * `restaurant:{id}`/`branch:{id}` rooms only (no floor-plan room exists) -
 * no Phase 9 notification consumes it.
 */
export interface TableMergedEventPayload {
  mergeGroupId: string;
  primaryTableId: string;
  memberTableIds: string[];
  branchId: string;
  floorPlanId: string;
  organizationId: string;
  effectiveCapacity: number;
  actorId: string;
  correlationId?: string;
}

export class TableMergedEvent extends DomainEvent {
  public readonly eventName = 'TableMerged';
  public readonly payload: TableMergedEventPayload;

  constructor(
    eventId: string,
    payload: TableMergedEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

/**
 * Phase 6 (Merge/Split Tables, ADR-026 decision #2/#10) - the Split
 * counterpart of `TableMergedEvent`, published by `SplitTablesUseCase` only,
 * after the split transaction commits. Carries the group identity and
 * membership as it existed immediately before the split (the group no
 * longer exists once this event is published) - no `effectiveCapacity`
 * (Split does not derive one; each member reverts to its own permanent
 * `capacity`).
 */
export interface TableSplitEventPayload {
  mergeGroupId: string;
  primaryTableId: string;
  memberTableIds: string[];
  branchId: string;
  floorPlanId: string;
  organizationId: string;
  actorId: string;
  correlationId?: string;
}

export class TableSplitEvent extends DomainEvent {
  public readonly eventName = 'TableSplit';
  public readonly payload: TableSplitEventPayload;

  constructor(
    eventId: string,
    payload: TableSplitEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}
