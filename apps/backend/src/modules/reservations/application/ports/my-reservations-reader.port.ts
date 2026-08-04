import { ReservationSource, ReservationStatus } from '../../domain/enums/reservation.enums';

/**
 * Phase 18.x (Customer Reservation History, mobile-facing) - the three
 * `GET /reservations/my*` routes differ ONLY in which slice of the caller's
 * own reservations they return; `all`/`upcoming`/`history` is the one
 * parameter that distinguishes them, resolved server-side from
 * `Reservation.status` + `Reservation.reservationStartTime` vs. "now" - the
 * client is never required to filter/derive this itself.
 *
 * `upcoming` = still active (`Pending`/`Approved`) AND scheduled in the
 * future (`reservationStartTime > now`).
 *
 * `history` = the exact complement of `upcoming` within the caller's own
 * reservations - `Rejected`/`Cancelled`/`Completed`/`Expired`/`NoShow` (every
 * terminal status, not only the "completed, cancelled, expired" subset the
 * phase spec names - `Rejected` is terminal too, and a Rejected reservation
 * has already happened as a past event even if its original scheduled time
 * has not yet arrived; excluding it would make it invisible to BOTH
 * `upcoming` and `history`) OR a still-active reservation whose scheduled
 * time has already passed (`Pending`/`Approved` with `reservationStartTime
 * <= now` - covers a stale Approved reservation staff never marked
 * Completed/NoShow) - "past reservations" in the phase spec's own wording.
 * `all` applies no status/time restriction beyond ownership.
 *
 * This complement relationship is deliberate: `upcoming` and `history`
 * together always partition `all` exactly (no reservation is ever missing
 * from both, none is ever double-counted) - proven by
 * `SearchMyReservationsUseCase`'s own spec.
 */
export type MyReservationTemporalScope = 'all' | 'upcoming' | 'history';

/**
 * `status` is only ever populated for scope `all` (`GET /reservations/my`'s
 * own optional filter, per the phase spec) - `SearchMyReservationsUseCase`
 * never receives it for `upcoming`/`history` because neither specialized
 * query DTO declares the field in the first place.
 */
export interface MyReservationsFilters {
  status?: ReservationStatus;
  restaurantId?: string;
  branchId?: string;
  /** Inclusive lower bound against `Reservation.reservationDate` (date-only, no time component). */
  dateFrom?: Date;
  /** Inclusive upper bound against `Reservation.reservationDate` (date-only, no time component). */
  dateTo?: Date;
}

export type MyReservationsSort = 'reservationDate' | 'createdAt';
export type MyReservationsSortOrder = 'asc' | 'desc';

export interface MyReservationTableInfo {
  tableId: string;
  tableNumber: string;
  capacity: number;
}

/**
 * The flat, customer-safe, join-enriched projection every `GET
 * /reservations/my*` route returns. Deliberately not `ReservationResult`
 * (which carries only ids) and not the `Reservation` domain entity (which
 * carries none of the cross-aggregate Restaurant/Branch/Table display
 * fields at all) - this is a dedicated read model, mirroring
 * `DiscoveryReaderPort`'s own "read-only, cross-aggregate, one
 * purpose-built result shape" precedent rather than stretching
 * `ReservationRepository`'s entity-returning contract to also carry display
 * data it has no other use for.
 *
 * `restaurantName`/`restaurantImage` reflect the Restaurant's CURRENT row,
 * even if it has since been soft-deleted (`Restaurant.deletedAt` set) or
 * suspended - unlike Favorites/Discovery, this is the Customer's own
 * historical record of a reservation that genuinely happened, not a
 * discovery listing, so a closed restaurant's past reservations must never
 * silently disappear or 404. `restaurantImage` is `Restaurant.coverImageId`
 * (a media asset id, the same field `RestaurantResponseDto` already exposes
 * verbatim elsewhere) - `null` when the restaurant never set one ("if
 * available" per the endpoint's own contract).
 *
 * `branchName`: `Branch` has no dedicated name column in DATABASE_SCHEMA.md
 * (Branches are identified by `city`/`district`/`address` everywhere else in
 * this codebase - see `BranchResponseDto`) - `branchName` is `Branch.address`,
 * the one free-text field that already serves as a human-readable branch
 * identifier on every other customer-facing Branch projection.
 *
 * `table` is never `null` in the current domain model - `Reservation.tableId`
 * is a mandatory, non-nullable FK at creation (Phase 7.1) with no
 * unassigned-table state - but is still shaped as an optional nested object
 * (not flattened `tableId`/`tableNumber`/`capacity` fields) per the phase
 * spec's own "table information (if assigned)" contract, so a future
 * table-less reservation type never requires a breaking response shape
 * change.
 */
export interface MyReservationItem {
  reservationId: string;
  restaurantId: string;
  restaurantName: string;
  restaurantImage: string | null;
  branchId: string;
  branchName: string;
  reservationDate: Date;
  reservationStartTime: Date;
  reservationEndTime: Date;
  partySize: number;
  status: ReservationStatus;
  reservationSource: ReservationSource;
  createdAt: Date;
  updatedAt: Date;
  specialRequest: string | null;
  table: MyReservationTableInfo | null;
}

export interface MyReservationsPage {
  items: MyReservationItem[];
  total: number;
}

/**
 * Owned by the Reservations bounded context (unlike `DiscoveryReaderPort`/
 * `RestaurantDirectoryReaderPort`, no cross-tenant-scoping bypass is needed
 * here - `Reservation` already carries direct `restaurantId`/`branchId`/
 * `tableId` FKs in the same schema, and `Restaurant`/`Branch`/`Table` are
 * loaded via a single joined query rooted at the caller's own `Reservation`
 * rows, never queried independently - see `PrismaMyReservationsReader`'s
 * own doc comment for why this never touches `withTenantScoping`'s
 * enforcement path at all). One shared `search` method backs all three
 * `GET /reservations/my*` routes (`scope` is the only axis that varies) -
 * the phase spec's own "reuse the same repository and query logic wherever
 * possible... avoid code duplication" instruction, satisfied structurally
 * rather than by convention.
 */
export interface MyReservationsReaderPort {
  search(
    userId: string,
    scope: MyReservationTemporalScope,
    filters: MyReservationsFilters,
    page: number,
    limit: number,
    sort: MyReservationsSort,
    order: MyReservationsSortOrder,
    now: Date,
  ): Promise<MyReservationsPage>;
}

export const MY_RESERVATIONS_READER = Symbol('MY_RESERVATIONS_READER');
