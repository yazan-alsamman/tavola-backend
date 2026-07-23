import { Entity } from '@shared/domain/base/entity.base';
import {
  BranchId,
  ReservationId,
  RestaurantId,
  TableId,
  UserId,
} from '@shared/domain/value-objects/identifiers.vo';
import { ReservationSource, ReservationStatus } from '../enums/reservation.enums';
import { InvalidReservationTimeException } from '../exceptions/invalid-reservation-time.exception';
import { InvalidReservationException } from '../exceptions/invalid-reservation.exception';
import { PartySizeExceedsCapacityException } from '../exceptions/party-size-exceeds-capacity.exception';
import { InvalidReservationStatusTransitionException } from '../exceptions/invalid-reservation-status-transition.exception';

export interface ReservationProps {
  id: string;
  userId: string | null;
  reservationGuestId: string | null;
  restaurantId: string;
  branchId: string;
  tableId: string;
  reservationDate: Date;
  reservationStartTime: Date;
  reservationEndTime: Date;
  guests: number;
  status: ReservationStatus;
  source: ReservationSource;
  notes: string | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  completedAt: Date | null;
  noShowAt: Date | null;
  lateArrivalNotifiedAt: Date | null;
  tableReadyNotifiedAt: Date | null;
  rescheduledFromReservationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Reservation Aggregate (DOMAIN_MODEL.md). `create()` (Phase 7.1) always
 * produces `status = Pending`. `createAutoApproved()` (Phase 7.2 - TASKS.md's
 * Phase 7 decision note item 2 / Phase 7.1 Scope Amendment) is the
 * `RestaurantSettings.autoApproval = true` path: the reservation is born
 * `Approved` directly, never transitions through `Pending`, and therefore
 * emits no redundant `Pending -> Approved` transition. `approve()`/`reject()`
 * (Phase 7.2 - TASKS.md's Phase 7 decision note item 1 / "Phase 7.2 —
 * Approval Workflow: Architecture Freeze") are the only two transitions
 * reachable from `Pending` via a public API this phase; the remaining
 * frozen-but-not-yet-reachable transitions (Cancel/Complete/Expire/NoShow)
 * are Phase 7.3+ and have no public method here yet - only the validation
 * matrix below is defined in full, per the Scope Amendment's own "the
 * `ReservationStatus` enum itself is still defined in full... a data-type
 * definition, not a use case" reasoning applied one layer deeper.
 */
export class Reservation extends Entity<ReservationProps> {
  /**
   * TASKS.md "Phase 7 — Reservation Engine: Pre-implementation architecture
   * decisions" item 1, frozen in full: `Pending -> {Approved, Rejected,
   * Expired, Cancelled}`; `Approved -> {Completed, Cancelled, NoShow}`. Every
   * other combination (including any same-status "transition") is invalid.
   * Terminal statuses (`Rejected`/`Cancelled`/`Completed`/`Expired`/`NoShow`)
   * have no outgoing transitions - "a completed reservation cannot return to
   * a pending state" / "a cancelled reservation cannot be approved"
   * (DOMAIN_MODEL.md).
   */
  private static readonly ALLOWED_TRANSITIONS: Readonly<
    Record<ReservationStatus, readonly ReservationStatus[]>
  > = {
    [ReservationStatus.Pending]: [
      ReservationStatus.Approved,
      ReservationStatus.Rejected,
      ReservationStatus.Expired,
      ReservationStatus.Cancelled,
    ],
    [ReservationStatus.Approved]: [
      ReservationStatus.Completed,
      ReservationStatus.Cancelled,
      ReservationStatus.NoShow,
    ],
    [ReservationStatus.Rejected]: [],
    [ReservationStatus.Cancelled]: [],
    [ReservationStatus.Completed]: [],
    [ReservationStatus.Expired]: [],
    [ReservationStatus.NoShow]: [],
  };

  private constructor(props: ReservationProps) {
    super(props);
  }

  /**
   * The only way a Reservation is created in Phase 7.1. `reservationGuestId`
   * is always null here (Online-source, User-only path - Phase 7.4 builds
   * the ReservationGuest path). `status` is always `Pending` - unconditional,
   * not a parameter - per the Phase 7.1 Scope Amendment.
   */
  static create(props: {
    id: string;
    userId: string;
    restaurantId: string;
    branchId: string;
    tableId: string;
    reservationDate: Date;
    reservationStartTime: Date;
    reservationEndTime: Date;
    guests: number;
    tableCapacity: number;
    notes: string | null;
    createdBy: string;
    now: Date;
  }): Reservation {
    validate(props);

    return new Reservation({
      id: props.id,
      userId: props.userId,
      reservationGuestId: null,
      restaurantId: props.restaurantId,
      branchId: props.branchId,
      tableId: props.tableId,
      reservationDate: props.reservationDate,
      reservationStartTime: props.reservationStartTime,
      reservationEndTime: props.reservationEndTime,
      guests: props.guests,
      status: ReservationStatus.Pending,
      source: ReservationSource.Online,
      notes: props.notes,
      createdBy: props.createdBy,
      approvedBy: null,
      approvedAt: null,
      cancelledAt: null,
      completedAt: null,
      noShowAt: null,
      lateArrivalNotifiedAt: null,
      tableReadyNotifiedAt: null,
      rescheduledFromReservationId: null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  /**
   * Phase 7.2 auto-approval path (TASKS.md Phase 7 decision note item 2 /
   * Phase 7.1 Scope Amendment): used only when
   * `RestaurantSettings.autoApproval === true`. The reservation is born
   * `Approved` directly - it never passes through `Pending`, so no
   * `Pending -> Approved` transition (and no corresponding event) ever
   * occurs for this path. `approvedBy` is `null` (a system/settings-driven
   * approval, not a specific Employee action) while `approvedAt` is set to
   * `now`, matching the moment of creation.
   */
  static createAutoApproved(props: {
    id: string;
    userId: string;
    restaurantId: string;
    branchId: string;
    tableId: string;
    reservationDate: Date;
    reservationStartTime: Date;
    reservationEndTime: Date;
    guests: number;
    tableCapacity: number;
    notes: string | null;
    createdBy: string;
    now: Date;
  }): Reservation {
    validate(props);

    return new Reservation({
      id: props.id,
      userId: props.userId,
      reservationGuestId: null,
      restaurantId: props.restaurantId,
      branchId: props.branchId,
      tableId: props.tableId,
      reservationDate: props.reservationDate,
      reservationStartTime: props.reservationStartTime,
      reservationEndTime: props.reservationEndTime,
      guests: props.guests,
      status: ReservationStatus.Approved,
      source: ReservationSource.Online,
      notes: props.notes,
      createdBy: props.createdBy,
      approvedBy: null,
      approvedAt: props.now,
      cancelledAt: null,
      completedAt: null,
      noShowAt: null,
      lateArrivalNotifiedAt: null,
      tableReadyNotifiedAt: null,
      rescheduledFromReservationId: null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: ReservationProps): Reservation {
    return new Reservation({ ...props });
  }

  get reservationId(): ReservationId {
    return ReservationId.create(this.props.id);
  }

  get userId(): UserId | null {
    return this.props.userId ? UserId.create(this.props.userId) : null;
  }

  get reservationGuestId(): string | null {
    return this.props.reservationGuestId;
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get branchId(): BranchId {
    return BranchId.create(this.props.branchId);
  }

  get tableId(): TableId {
    return TableId.create(this.props.tableId);
  }

  get reservationDate(): Date {
    return new Date(this.props.reservationDate.getTime());
  }

  get reservationStartTime(): Date {
    return new Date(this.props.reservationStartTime.getTime());
  }

  get reservationEndTime(): Date {
    return new Date(this.props.reservationEndTime.getTime());
  }

  get guests(): number {
    return this.props.guests;
  }

  get status(): ReservationStatus {
    return this.props.status;
  }

  get source(): ReservationSource {
    return this.props.source;
  }

  get notes(): string | null {
    return this.props.notes;
  }

  get createdBy(): string {
    return this.props.createdBy;
  }

  get approvedBy(): string | null {
    return this.props.approvedBy;
  }

  get approvedAt(): Date | null {
    return this.props.approvedAt ? new Date(this.props.approvedAt.getTime()) : null;
  }

  get cancelledAt(): Date | null {
    return this.props.cancelledAt ? new Date(this.props.cancelledAt.getTime()) : null;
  }

  get completedAt(): Date | null {
    return this.props.completedAt ? new Date(this.props.completedAt.getTime()) : null;
  }

  get noShowAt(): Date | null {
    return this.props.noShowAt ? new Date(this.props.noShowAt.getTime()) : null;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  /**
   * Phase 7.2 (manual Approval path only - the auto-approval path uses
   * `createAutoApproved()` instead and never calls this method). Only a
   * `Pending` reservation may be approved. Sets `approvedBy` to the
   * approving Employee's id and `approvedAt` to `now`. Calling
   * `Table.reserve()` is the caller's (`ApproveReservationUseCase`'s)
   * responsibility, inside the same ADR-013 advisory-locked transaction -
   * this entity has no knowledge of `Table`.
   */
  approve(approvedBy: string, at: Date): Reservation {
    this.assertTransition(ReservationStatus.Approved);
    return Reservation.reconstitute({
      ...this.props,
      status: ReservationStatus.Approved,
      approvedBy,
      approvedAt: at,
      updatedAt: at,
    });
  }

  /**
   * Manual Reject (Phase 7.2). Only a `Pending` reservation may be rejected.
   * Performs no Table operation and carries no system-generated note -
   * distinguishing it from `autoReject()` below (TASKS.md's "Phase 7.2 —
   * Approval Workflow: Architecture Correction": a reservation can only be
   * rejected while still `Pending`, and a `Pending` reservation never
   * reserved the table, so there is nothing to release).
   */
  reject(at: Date): Reservation {
    this.assertTransition(ReservationStatus.Rejected);
    return Reservation.reconstitute({
      ...this.props,
      status: ReservationStatus.Rejected,
      updatedAt: at,
    });
  }

  /**
   * Automatic rejection of another overlapping `Pending` reservation for the
   * same table, triggered by a different reservation's Approval
   * (DOMAIN_MODEL.md: "approving the first automatically rejects any other
   * pending reservation... with a system-generated note explaining the
   * automatic rejection"). Identical state transition and Table-operation
   * consequence (none) as manual `reject()`; the only difference is the
   * appended system note, appended rather than overwriting any existing
   * customer-supplied `notes` (DATABASE_SCHEMA.md documents no separate
   * rejection-reason column).
   */
  autoReject(at: Date, systemNote: string): Reservation {
    this.assertTransition(ReservationStatus.Rejected);
    const combinedNotes = this.props.notes ? `${this.props.notes}\n${systemNote}` : systemNote;
    return Reservation.reconstitute({
      ...this.props,
      status: ReservationStatus.Rejected,
      notes: combinedNotes,
      updatedAt: at,
    });
  }

  /**
   * Phase 7.3 (Reservation Lifecycle). Reachable from `Pending` or
   * `Approved` (both non-terminal); rejected from every terminal status via
   * the frozen transition matrix. Sets `cancelledAt`. Calling `Table.release()`
   * (only when the source status was `Approved`) is the caller's
   * (`CancelReservationUseCase`'s) responsibility - this entity has no
   * knowledge of `Table`.
   */
  cancel(at: Date): Reservation {
    this.assertTransition(ReservationStatus.Cancelled);
    return Reservation.reconstitute({
      ...this.props,
      status: ReservationStatus.Cancelled,
      cancelledAt: at,
      updatedAt: at,
    });
  }

  /**
   * Phase 7.3 (Reservation Lifecycle). `Approved -> Completed` only. Sets
   * `completedAt`. Enforces "a reservation may be marked Completed only
   * once its scheduled service window has begun" (DOMAIN_MODEL.md,
   * analogous to the No-Show timing rule) - rejects a `completedAt` earlier
   * than `reservationStartTime`. Calling `Table.release()` is the caller's
   * responsibility.
   */
  complete(at: Date): Reservation {
    this.assertTransition(ReservationStatus.Completed);
    if (at.getTime() < this.props.reservationStartTime.getTime()) {
      throw new InvalidReservationTimeException(
        'A reservation cannot be marked Completed before its scheduled service window has begun.',
      );
    }
    return Reservation.reconstitute({
      ...this.props,
      status: ReservationStatus.Completed,
      completedAt: at,
      updatedAt: at,
    });
  }

  /**
   * Phase 7.3 (Reservation Lifecycle). `Approved -> NoShow` only, and only
   * after the reservation's scheduled time has passed (DOMAIN_MODEL.md's
   * No-Show policy). Sets `noShowAt`. Calling `Table.release()` is the
   * caller's responsibility.
   */
  markNoShow(at: Date): Reservation {
    this.assertTransition(ReservationStatus.NoShow);
    if (at.getTime() < this.props.reservationStartTime.getTime()) {
      throw new InvalidReservationTimeException(
        'A reservation cannot be marked NoShow before its scheduled time has passed.',
      );
    }
    return Reservation.reconstitute({
      ...this.props,
      status: ReservationStatus.NoShow,
      noShowAt: at,
      updatedAt: at,
    });
  }

  /**
   * Phase 7.3 (Reservation Lifecycle). `Pending -> Expired` only -
   * `Approved -> Expired` does not exist in the frozen state machine (see
   * TASKS.md's Phase 7.3 decision note item 2). Performs no Table
   * operation - a `Pending` reservation never reserved a table.
   */
  expire(at: Date): Reservation {
    this.assertTransition(ReservationStatus.Expired);
    return Reservation.reconstitute({
      ...this.props,
      status: ReservationStatus.Expired,
      updatedAt: at,
    });
  }

  /**
   * Phase 7.3 (Reservation Lifecycle) - an in-place modification, never a
   * status transition. Reachable only while `Pending` or `Approved`
   * (`assertReschedulable`). May change `tableId`/`reservationDate`/
   * `reservationStartTime`/`reservationEndTime`/`guests` together, subject
   * to the same creation-time invariants (`validate`) applied to the new
   * values - "the new date/time/table combination independently passes the
   * same availability and locking checks as a new reservation"
   * (DOMAIN_MODEL.md). The cancellation-window check and the target Table's
   * same-Branch/availability/lock checks are the caller's
   * (`RescheduleReservationUseCase`'s) responsibility - this entity only
   * enforces the invariants it can verify from its own fields.
   */
  reschedule(props: {
    tableId: string;
    reservationDate: Date;
    reservationStartTime: Date;
    reservationEndTime: Date;
    guests: number;
    tableCapacity: number;
    now: Date;
  }): Reservation {
    this.assertReschedulable();
    validate({
      reservationStartTime: props.reservationStartTime,
      reservationEndTime: props.reservationEndTime,
      guests: props.guests,
      tableCapacity: props.tableCapacity,
      now: props.now,
    });
    return Reservation.reconstitute({
      ...this.props,
      tableId: props.tableId,
      reservationDate: props.reservationDate,
      reservationStartTime: props.reservationStartTime,
      reservationEndTime: props.reservationEndTime,
      guests: props.guests,
      updatedAt: props.now,
    });
  }

  private assertTransition(target: ReservationStatus): void {
    const allowed = Reservation.ALLOWED_TRANSITIONS[this.props.status];
    if (!allowed.includes(target)) {
      throw new InvalidReservationStatusTransitionException(
        `Cannot transition reservation status from "${this.props.status}" to "${target}".`,
      );
    }
  }

  private assertReschedulable(): void {
    const reschedulable =
      this.props.status === ReservationStatus.Pending ||
      this.props.status === ReservationStatus.Approved;
    if (!reschedulable) {
      throw new InvalidReservationStatusTransitionException(
        `Cannot reschedule a reservation with status "${this.props.status}" - only Pending or Approved reservations may be rescheduled.`,
      );
    }
  }

  toProps(): Readonly<ReservationProps> {
    return { ...this.props };
  }
}

function validate(props: {
  reservationStartTime: Date;
  reservationEndTime: Date;
  guests: number;
  tableCapacity: number;
  now: Date;
}): void {
  if (props.reservationStartTime.getTime() <= props.now.getTime()) {
    throw new InvalidReservationTimeException('Reservation time must be in the future.');
  }
  if (props.reservationEndTime.getTime() <= props.reservationStartTime.getTime()) {
    throw new InvalidReservationTimeException(
      'reservationEndTime must be after reservationStartTime.',
    );
  }
  if (!Number.isInteger(props.guests) || props.guests <= 0) {
    throw new InvalidReservationException('guests must be a positive integer.');
  }
  if (props.guests > props.tableCapacity) {
    throw new PartySizeExceedsCapacityException(props.guests, props.tableCapacity);
  }
}
