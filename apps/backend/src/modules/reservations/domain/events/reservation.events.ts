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
 * `createdBy` carries the acting principal's own id - the Customer's
 * `userId` for Online, the Employee's `employeeId` for Phone/WalkIn (Phase
 * 7.4 decision #6, the same `approvedBy`/`actor.employeeId` precedent
 * `ReservationApprovedEvent` already established) - or `null` for `source:
 * WaitlistConversion` created by an automatic (System) Waitlist promotion
 * (Phase 7.5). `AuditingEventPublisher.toAuditEntry`'s `ReservationCreatedEvent`
 * branch derives the three-way `actorType` (`User`/`Employee`/`System`) from
 * `userId`/`createdBy` together (Phase 7.5).
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
      createdBy: string | null;
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

/**
 * Phase 7.6 (Operational Signals, ADR-019) - domain/event side only, per
 * TASKS.md's own scope note ("actual notification delivery may be better
 * sequenced alongside Phase 9's `NotificationProvider`"). Published by the
 * Reminder BullMQ job (`ReminderProcessor`), scheduled
 * `reservationReminderMinutesBefore` minutes before `reservationStartTime`
 * for every Approved reservation. No authenticated HTTP actor - always
 * `actorType: System` (`AuditingEventPublisher`), matching
 * `ReservationExpiredEvent`'s own precedent. The processor itself performs
 * no state mutation (reminders are informational only, unlike Late Arrival
 * which flips `lateArrivalNotifiedAt`) - this event's own publication IS the
 * signal, so it carries no "already notified" guard.
 */
export class ReservationReminderDueEvent extends DomainEvent {
  public readonly eventName = 'ReservationReminderDue';

  constructor(
    eventId: string,
    public readonly payload: ReservationEventPayload & {
      reservationId: string;
      restaurantId: string;
      branchId: string;
      reservationStartTime: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Phase 9 (architecture frozen 2026-07-25, TASKS.md decision item 6) - "Due"
 * (scheduled/computed, Phase 7.6) and "Sent" (actual provider-acceptance
 * confirmation, Phase 9) are deliberately distinct concepts. Fires once per
 * logical reminder (never once per channel), published by
 * `RecordPushOutcomeUseCase` only when the corresponding `Notification`'s
 * `pushStatus` transitions to `Accepted` - never on `notificationOptIn =
 * false` (push never attempted) or a `Failed` push (retry budget
 * exhausted). Never claims device-level delivery - only that the provider
 * (OneSignal) accepted the send request. No authenticated actor - always
 * `actorType: System`, mirroring `ReservationReminderDueEvent`'s own
 * precedent.
 */
export class ReservationReminderSentEvent extends DomainEvent {
  public readonly eventName = 'ReservationReminderSent';

  constructor(
    eventId: string,
    public readonly payload: ReservationEventPayload & {
      reservationId: string;
      restaurantId: string;
      branchId: string;
      reservationStartTime: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Phase 7.6 (Operational Signals, ADR-019) - published by the Late-Arrival
 * BullMQ job (`LateArrivalProcessor`) only when
 * `Reservation.markLateArrivalNotifiedIfEligible` actually applied (still
 * `Approved`, not already notified) - a stale/no-op firing (reservation
 * already left `Approved`, or already notified by a prior run) publishes
 * nothing. No authenticated HTTP actor - always `actorType: System`, exactly
 * like `ReservationReminderDueEvent` above. Does NOT free the table or
 * change `status` - a late arrival remains a staff decision
 * (Cancel/NoShow), never automatic.
 */
export class GuestLateArrivalNotifiedEvent extends DomainEvent {
  public readonly eventName = 'GuestLateArrivalNotified';

  constructor(
    eventId: string,
    public readonly payload: ReservationEventPayload & {
      reservationId: string;
      restaurantId: string;
      branchId: string;
      reservationStartTime: string;
      lateArrivalNotifiedAt: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Phase 7.6 (Operational Signals, ADR-019) - the one Operational Signal that
 * is staff-initiated rather than BullMQ-driven (`POST
 * /reservations/:id/table-ready`, `MarkTableReadyUseCase`). `markedBy`
 * always carries the acting Employee's id, mirroring
 * `ReservationCompletedEvent`/`ReservationNoShowEvent`'s own staff-only
 * `markedBy`/`completedBy` pattern - never `null`.
 */
export class TableReadyNotifiedEvent extends DomainEvent {
  public readonly eventName = 'TableReadyNotified';

  constructor(
    eventId: string,
    public readonly payload: ReservationEventPayload & {
      reservationId: string;
      restaurantId: string;
      branchId: string;
      reservationStartTime: string;
      tableReadyNotifiedAt: string;
      markedBy: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}
