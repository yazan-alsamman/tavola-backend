import { DomainEvent } from '@shared/domain/base/domain-event.base';
import { ReservationSource } from '../enums/reservation.enums';

export interface ReservationEventPayload {
  correlationId?: string;
}

/**
 * Phase 7 decision note item 10: a real domain event class, not audit-only -
 * unlike Move Table/Status Management's audit-only precedent (which applied
 * because those actions had no consumers), `ReservationCreated` already has
 * named consumers in EVENTS.md/DOMAIN_MODEL.md (Analytics, Notifications,
 * WebSocket per Phase 8/9/14). Widened by Phase 7.4 decision #11 to carry
 * `source` and both party fields, unifying Online/Phone/WalkIn onto this one
 * event class (the legacy `PhoneReservationCreated`/`WalkInReservationCreated`
 * proposal in EVENTS.md is superseded, not implemented). `userId` is `null`
 * for a Phone/WalkIn reservation (`reservationGuestId` set instead);
 * `createdBy` always carries the acting principal's own id - the Customer's
 * `userId` for Online, the Employee's `employeeId` for Phone/WalkIn (Phase
 * 7.4 decision #6, the same `approvedBy`/`actor.employeeId` precedent
 * `ReservationApprovedEvent` already established).
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
      userId: string | null;
      reservationGuestId: string | null;
      source: ReservationSource;
      createdBy: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Phase 7.2 (Approval Workflow, architecture frozen 2026-07-20) - a real
 * domain event class per TASKS.md Phase 7 decision note item 10 (already-named
 * consumers: Analytics, Notifications, WebSocket per Phase 8/9/14). Published
 * for both the manual Approve path (`approvedBy` set to the approving
 * Employee's id) and the auto-approval branch of Create Reservation
 * (`approvedBy: null`, `automatic: true`).
 */
export class ReservationApprovedEvent extends DomainEvent {
  public readonly eventName = 'ReservationApproved';

  constructor(
    eventId: string,
    public readonly payload: ReservationEventPayload & {
      reservationId: string;
      restaurantId: string;
      branchId: string;
      tableId: string;
      approvedBy: string | null;
      automatic: boolean;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Phase 7.2 - covers both manual Reject (`rejectedBy` set to the rejecting
 * Employee's id, `automatic: false`) and automatic rejection of an
 * overlapping Pending reservation triggered by a different reservation's
 * Approval (`rejectedBy: null`, `automatic: true`). Neither path performs any
 * `Table` operation (Phase 7.2 Architecture Correction).
 */
export class ReservationRejectedEvent extends DomainEvent {
  public readonly eventName = 'ReservationRejected';

  constructor(
    eventId: string,
    public readonly payload: ReservationEventPayload & {
      reservationId: string;
      restaurantId: string;
      branchId: string;
      tableId: string;
      rejectedBy: string | null;
      automatic: boolean;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Phase 7.3 (Reservation Lifecycle, architecture frozen 2026-07-23) - a real
 * domain event class per the same "already-named consumers" reasoning
 * (Phase 7 decision note item 10). Reachable by both the reservation's own
 * Customer and a branch-scoped Employee (`cancelledBy` carries whichever
 * actor's id - `userId` for a Customer, `employeeId` for an Employee).
 */
export class ReservationCancelledEvent extends DomainEvent {
  public readonly eventName = 'ReservationCancelled';

  constructor(
    eventId: string,
    public readonly payload: ReservationEventPayload & {
      reservationId: string;
      restaurantId: string;
      branchId: string;
      tableId: string;
      cancelledBy: string;
      withinCancellationWindow: boolean;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Phase 7.3 - reachable by both Customer and Employee, like
 * `ReservationCancelledEvent`. Carries `oldTableId`/`newTableId` (equal when
 * the reschedule kept the same Table) so consumers can distinguish a
 * same-table time change from a table-changing reschedule (ADR-023).
 */
export class ReservationRescheduledEvent extends DomainEvent {
  public readonly eventName = 'ReservationRescheduled';

  constructor(
    eventId: string,
    public readonly payload: ReservationEventPayload & {
      reservationId: string;
      restaurantId: string;
      branchId: string;
      oldTableId: string;
      newTableId: string;
      rescheduledBy: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Phase 7.3 - staff-only action; `completedBy` always carries the acting
 * Employee's id.
 */
export class ReservationCompletedEvent extends DomainEvent {
  public readonly eventName = 'ReservationCompleted';

  constructor(
    eventId: string,
    public readonly payload: ReservationEventPayload & {
      reservationId: string;
      restaurantId: string;
      branchId: string;
      tableId: string;
      completedBy: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Phase 7.3 - staff-only action; `markedBy` always carries the acting
 * Employee's id. No-show customer restriction/counting policy remains a
 * deferred future product decision (DOMAIN_MODEL.md) - this event exists so
 * that data is available once such a policy is implemented, not to
 * implement it now.
 */
export class ReservationNoShowEvent extends DomainEvent {
  public readonly eventName = 'ReservationNoShow';

  constructor(
    eventId: string,
    public readonly payload: ReservationEventPayload & {
      reservationId: string;
      restaurantId: string;
      branchId: string;
      tableId: string;
      markedBy: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Phase 7.3 - the BullMQ-driven expiration job has no authenticated HTTP
 * actor at all; audited with `actorType: 'System'`, matching the existing
 * `AuditActorType` enum's third value already used for Phase 7.2's
 * auto-approval/auto-rejection.
 */
export class ReservationExpiredEvent extends DomainEvent {
  public readonly eventName = 'ReservationExpired';

  constructor(
    eventId: string,
    public readonly payload: ReservationEventPayload & {
      reservationId: string;
      restaurantId: string;
      branchId: string;
      tableId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}
