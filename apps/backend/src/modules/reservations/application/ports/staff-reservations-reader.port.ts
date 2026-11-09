import { ReservationSource, ReservationStatus } from '../../domain/enums/reservation.enums';

/**
 * Restaurant Dashboard Calendar (day/week/month views all reduce to one
 * bounded `[dateFrom, dateTo]` query, per the endpoint's own controller doc
 * comment) - both bounds are REQUIRED, unlike `MyReservationsFilters`'
 * optional `dateFrom`/`dateTo` (a Customer's own reservation set is small
 * enough to safely default to "all time"; a branch's full reservation
 * history is not). Filtered against `Reservation.reservationDate` (date-only,
 * inclusive), the exact same column/semantics `MyReservationsReaderPort`
 * already filters on - not `reservationStartTime`/Branch timezone bucketing
 * (ADR-028's convention for Analytics trend charts, a different concern with
 * its own documented reason: `reservationDate` "is not reliably Branch-local").
 * This keeps exactly one date-range filtering convention for reservation LIST
 * endpoints across the module.
 */
export interface StaffReservationsFilters {
  status?: ReservationStatus;
  dateFrom: Date;
  dateTo: Date;
  /**
   * CR WJ-R-2026-002 round 2 (customer page): narrows the list to one
   * customer, by the same `customer.key` every list item carries.
   */
  customerKey?: StaffReservationCustomerKey;
}

/**
 * A stable handle for "the same customer" across bookings at a restaurant:
 * the registered User, or a guest identified by the phone staff typed in.
 */
export type StaffReservationCustomerKey =
  { type: 'User'; userId: string } | { type: 'Guest'; phone: string };

export interface StaffReservationTableInfo {
  tableId: string;
  tableNumber: string;
  capacity: number;
}

export type StaffReservationCustomerType = 'User' | 'Guest';

/**
 * `ReservationGuest` is a dependent entity of the Reservation aggregate
 * (DOMAIN_MODEL.md) and `User` is the party a branch-scoped Employee is
 * already fully authorized to act on (approve/cancel/reschedule) for THIS
 * reservation - resolving a display name/phone here is not a new access
 * grant, only a join-for-display of data the Reservation aggregate already
 * carries (the same "join for display, never a separate access decision"
 * precedent `MyReservationsReaderPort` already applies to Restaurant/Branch/
 * Table). `name`/`phone` are both nullable: a `User` customer's
 * `firstName`/`lastName`/`phone` are themselves nullable columns
 * (ADR-022 - never collected at registration).
 */
export interface StaffReservationCustomerInfo {
  type: StaffReservationCustomerType;
  name: string | null;
  phone: string | null;
  /** `user:<uuid>` or `guest:<phone>`; null for an anonymized guest with no phone. */
  key: string | null;
  /** Completed visits at this restaurant (all branches), this booking included. */
  visitCount: number;
  /** No-shows at this restaurant (all branches). */
  noShowCount: number;
}

export type StaffReservationActorKind = 'Customer' | 'Restaurant' | 'System';

/**
 * CR WJ-R-2026-002 round 2: how the reservation reached its current final
 * status - who moved it there and why. Null while Pending/Approved.
 */
export interface StaffReservationStatusChange {
  status: ReservationStatus;
  changedBy: StaffReservationActorKind;
  reason: string | null;
  changedAt: Date;
}

/** CR WJ-R-2026-002 round 2: the offer that brought this booking in. */
export interface StaffReservationOfferInfo {
  offerId: string;
  title: string;
}

export interface StaffReservationItem {
  reservationId: string;
  restaurantId: string;
  branchId: string;
  reservationDate: Date;
  reservationStartTime: Date;
  reservationEndTime: Date;
  partySize: number;
  status: ReservationStatus;
  reservationSource: ReservationSource;
  createdAt: Date;
  updatedAt: Date;
  specialRequest: string | null;
  table: StaffReservationTableInfo;
  customer: StaffReservationCustomerInfo;
  offer: StaffReservationOfferInfo | null;
  /** Staff-only note; never shown to the customer. */
  internalNote: string | null;
  /** When a Pending booking expires unanswered; null in every other status. */
  approvalDeadlineAt: Date | null;
  statusChange: StaffReservationStatusChange | null;
}

export interface StaffReservationsPage {
  items: StaffReservationItem[];
  total: number;
}

/**
 * Restaurant Dashboard Calendar reader, owned by the Reservations bounded
 * context, mirroring `MyReservationsReaderPort`'s own "one join query, no
 * N+1" shape but scoped by `restaurantId`/`branchId` instead of `userId`.
 * Backs `GET /restaurants/:restaurantId/branches/:branchId/reservations`,
 * the single date-range endpoint that serves the Day/Week/Month calendar
 * views (the caller picks `dateFrom`/`dateTo` accordingly - see
 * `BranchReservationsController`'s own doc comment). Always ordered
 * `reservationStartTime asc` (calendar-natural chronological order) - unlike
 * `MyReservationsReaderPort`, no configurable `sort`/`order` is exposed since
 * exactly one order ever makes sense for this view.
 */
export interface StaffReservationsReaderPort {
  search(
    restaurantId: string,
    branchId: string,
    filters: StaffReservationsFilters,
    page: number,
    limit: number,
  ): Promise<StaffReservationsPage>;
}

export const STAFF_RESERVATIONS_READER = Symbol('STAFF_RESERVATIONS_READER');
