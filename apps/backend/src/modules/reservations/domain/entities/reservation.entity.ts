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
 * Reservation Aggregate (DOMAIN_MODEL.md). Phase 7.1 scope only (TASKS.md's
 * Phase 7.1 Scope Amendment, 2026-07-20): `create()` is the only factory -
 * always produces `status = Pending`, regardless of
 * `RestaurantSettings.autoApproval` (that setting is not read by this phase
 * at all). `Table.reserve()`/`TableStatus.Reserved` do not exist yet and are
 * never touched by this entity or its callers. No transition-validating
 * method exists yet either (`Approve`/`Reject`/`Cancel`/etc. are Phase 7.2+).
 */
export class Reservation extends Entity<ReservationProps> {
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

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
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
