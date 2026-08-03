import { Reservation } from '../entities/reservation.entity';
import { ReservationStatus } from '../enums/reservation.enums';
import { ReservationId, TableId, UserId } from '@shared/domain/value-objects/identifiers.vo';

export interface ReservationListPage {
  items: Reservation[];
  total: number;
}

/**
 * `Reservation` carries `restaurantId`/`branchId` directly but is not in
 * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (customer-facing writes
 * are not organization-scoped the way admin CRUD is) - tenant validation for
 * Create Reservation is the caller's responsibility (resolve Restaurant/
 * Branch/Table first), exactly like every other transitively-tenant-owned
 * repository in this codebase. For Phase 7.2's Employee-actor Approve/Reject
 * paths, tenant/branch-scope validation compares `Reservation.restaurantId`/
 * `branchId` directly against the already-resolved `AuthenticatedEmployeeActor`
 * JWT claims (`restaurantId`/`branchIds`) - no additional repository lookup
 * is required for that check.
 */
export interface ReservationRepository {
  /**
   * Every `Pending`/`Approved` reservation overlapping `[startTime, endTime)`
   * for this table - used by Search Availability to mark a table
   * Reserved/Unavailable (Phase 7.1 architecture decision: informational
   * only, never used to reject a create request).
   */
  findOverlappingPendingOrApproved(
    tableId: TableId,
    startTime: Date,
    endTime: Date,
  ): Promise<Reservation[]>;

  /**
   * Batched counterpart of `findOverlappingPendingOrApproved`: every
   * `Pending`/`Approved` reservation overlapping `[startTime, endTime)` for
   * ANY of the given tables, in one query - used by
   * `SearchAvailabilityUseCase` and `WaitlistPromotionService.selectTable` to
   * avoid one round-trip per candidate table when scanning a whole branch's
   * worth of Available tables.
   */
  findOverlappingPendingOrApprovedForTables(
    tableIds: TableId[],
    startTime: Date,
    endTime: Date,
  ): Promise<Reservation[]>;

  /**
   * The ADR-013 advisory-locked create path: acquires
   * `pg_advisory_xact_lock(hashtextextended(lockKey, 0))`, re-checks for an
   * overlapping confirmed (`Approved`/`Completed`/`NoShow`) reservation for
   * the same table inside the same transaction, then inserts - all as one
   * atomic unit, self-contained in its own transaction. Throws
   * `ReservationConflictException` if a confirmed overlap is found.
   */
  createWithLock(reservation: Reservation, lockKey: string): Promise<void>;

  /**
   * Phase 7.2: identical lock/check/insert body as `createWithLock`, but
   * does NOT open its own transaction - the caller (`CreateReservationUseCase`'s
   * auto-approval branch) is expected to already be inside a
   * `UnitOfWorkPort.execute`/`PrismaContext.runInTransaction` block, so that
   * the reservation insert, `Table.reserve()`, and any auto-rejection of
   * overlapping Pending reservations commit atomically together. Extracted
   * from `createWithLock` (which now simply wraps this in its own
   * transaction) rather than duplicated, so both paths share one tested
   * implementation.
   */
  createWithLockInTransaction(reservation: Reservation, lockKey: string): Promise<void>;

  /**
   * Loads a single Reservation by id, or `null` if it does not exist. No
   * tenant/branch filter - callers compare `restaurantId`/`branchId`
   * themselves (see this interface's own doc comment).
   */
  findById(id: ReservationId): Promise<Reservation | null>;

  /**
   * ADR-013 (Approval mechanics #1): acquires
   * `pg_advisory_xact_lock(hashtextextended(lockKey, 0))` for the given key.
   * Must be called inside an active transaction - the lock is released
   * automatically at commit/rollback. Used by `ApproveReservationUseCase`
   * before its own re-check, mirroring the Create path's own mechanism.
   */
  acquireAdvisoryLock(lockKey: string): Promise<void>;

  /**
   * The Approval-time counterpart of `createWithLock`'s own pre-insert
   * check: is there already a confirmed (`Approved`/`Completed`/`NoShow`)
   * reservation overlapping `[startTime, endTime)` for this table, other
   * than the one being approved? Must be called after `acquireAdvisoryLock`
   * inside the same transaction (ADR-013).
   */
  findConfirmedOverlapExcluding(
    tableId: TableId,
    startTime: Date,
    endTime: Date,
    excludeReservationId: ReservationId,
  ): Promise<Reservation | null>;

  /**
   * Every OTHER `Pending` reservation overlapping `[startTime, endTime)` for
   * this table - the auto-rejection candidate set (DOMAIN_MODEL.md:
   * "approving the first automatically rejects any other pending
   * reservation whose time window overlaps the same table").
   */
  findOtherOverlappingPending(
    tableId: TableId,
    startTime: Date,
    endTime: Date,
    excludeReservationId: ReservationId,
  ): Promise<Reservation[]>;

  /**
   * Persists a Reservation whose in-memory status has already transitioned
   * away from `Pending` (Approve/Reject/auto-Reject), using a
   * database-level conditional `UPDATE ... WHERE id = ? AND status =
   * 'Pending'` (ADR-013's own "Alternatives Considered" section recommends
   * optimistic locking as "a secondary, complementary technique for
   * reservation update/approval operations"). Returns `true` if the row was
   * still `Pending` and the update applied, `false` if a concurrent writer
   * had already moved it away from `Pending` (no rows matched) - the caller
   * decides whether that is an error (the primary Approve/Reject target) or
   * a harmless no-op (an auto-reject candidate already resolved by another
   * request). Also maps a database-level exclusion-constraint violation to
   * `ReservationConflictException`, exactly like `createWithLock`'s own
   * insert-time catch (ADR-013 compliance).
   *
   * Phase 7.3: a thin, behavior-preserving wrapper around
   * `updateTransitioningFrom(reservation, ReservationStatus.Pending)` -
   * kept as its own method, unchanged in signature, so the already-shipped
   * Phase 7.2 Approve/Reject/auto-reject call sites and tests are
   * unaffected.
   */
  updateTransitioningFromPending(reservation: Reservation): Promise<boolean>;

  /**
   * Phase 7.3 generalization of `updateTransitioningFromPending`: the same
   * conditional `UPDATE ... WHERE id = ? AND status = ?` mechanism, guarding
   * on any `expectedCurrentStatus` rather than only `Pending` - required
   * because Cancel-of-Approved/Complete/NoShow transition FROM `Approved`,
   * and Reschedule (which does not change status at all) still needs the
   * same optimistic-concurrency guard against a concurrent transition
   * changing the row's status out from under it. Updates every mutable
   * Reservation column (`status`, `tableId`, `reservationDate`,
   * `reservationStartTime`, `reservationEndTime`, `guests`, `notes`,
   * `approvedBy`, `approvedAt`, `cancelledAt`, `completedAt`, `noShowAt`,
   * `lateArrivalNotifiedAt`, `tableReadyNotifiedAt`, `updatedAt`) from the
   * given entity's current in-memory state (Phase 7.6: the two Operational
   * Signal timestamps join this column list so Reschedule's unconditional
   * reset - `Reservation.reschedule()` - actually persists). Same
   * `true`/`false`/`ReservationConflictException` semantics as
   * `updateTransitioningFromPending`.
   */
  updateTransitioningFrom(
    reservation: Reservation,
    expectedCurrentStatus: ReservationStatus,
  ): Promise<boolean>;

  /**
   * Phase 7.6 (Operational Signals, ADR-019) - the Late-Arrival BullMQ job's
   * sole write, a direct `UPDATE reservations SET late_arrival_notified_at =
   * ?, updated_at = ? WHERE id = ? AND status = 'Approved' AND
   * late_arrival_notified_at IS NULL`. Returns `true` only if the row
   * actually matched (still `Approved`, not already notified) - the
   * processor treats `false` as a safe no-op (the reservation moved on, or a
   * concurrent run already notified it), never an error. Deliberately a
   * narrower, single-column CAS than `updateTransitioningFrom` (no
   * in-memory entity round-trip needed at the call site) since the job only
   * ever has a reservation id and a timestamp, not a full loaded entity.
   */
  markLateArrivalNotifiedIfEligible(reservationId: ReservationId, at: Date): Promise<boolean>;

  /**
   * Phase 7.6 (Operational Signals, ADR-019) - the staff-initiated Table
   * Ready action's sole write (`MarkTableReadyUseCase`), the same
   * single-column CAS shape as `markLateArrivalNotifiedIfEligible` above:
   * `UPDATE reservations SET table_ready_notified_at = ?, updated_at = ?
   * WHERE id = ? AND status = 'Approved' AND table_ready_notified_at IS
   * NULL`. Returns `false` when the reservation is no longer `Approved` or
   * has already been marked ready - the use case surfaces that as
   * `InvalidReservationStatusTransitionException`, not a silent no-op
   * (unlike the Late-Arrival job, this is a direct staff action, not a
   * background sweep).
   */
  markTableReadyNotifiedIfEligible(reservationId: ReservationId, at: Date): Promise<boolean>;

  /**
   * Phase 6 (Merge/Split Tables, ADR-026 decision #6) - Merge/Split's own
   * reservation-blocking check: is there any `Pending`/`Approved`
   * reservation for `tableId` whose `reservationEndTime` has not yet passed
   * (`> now`)? `Rejected`/`Cancelled`/`Expired` and historical `Completed`/
   * `NoShow` never block (they are excluded by the status filter). Must be
   * called AFTER `TableRepository.acquireTopologyLocks` inside the same
   * transaction, exactly like `findConfirmedOverlapExcluding`'s own
   * "re-check inside the lock" placement for ADR-013.
   */
  hasBlockingReservation(tableId: TableId, now: Date): Promise<boolean>;

  /**
   * Post-Audit Remediation (2026-08-02, L5) - batched sibling of
   * `hasBlockingReservation` for `MergeTablesUseCase`, which previously
   * called the single-table method once per member inside the same
   * topology-locked transaction (an N+1 pattern that extended lock hold
   * time linearly with merge-group size). Returns the subset of `tableIds`
   * that have a blocking `Pending`/`Approved` reservation - same blocking
   * definition as `hasBlockingReservation`, one round trip regardless of
   * how many table ids are passed. Must be called under the same
   * "after `acquireTopologyLocks`, inside the transaction" placement rule.
   */
  findBlockedTableIds(tableIds: TableId[], now: Date): Promise<TableId[]>;

  /**
   * Customer Restaurant Discovery & Public Read Surface: every Reservation
   * owned by this Customer (`Reservation.userId` match), newest-created
   * first, paginated - the sole authority for `GET /reservations` (mine).
   * A guest (Phone/WalkIn) reservation has `userId: null` and never matches
   * any `UserId`, so it is structurally excluded - never returned to any
   * Customer actor, matching AUTHORIZATION_ARCHITECTURE.md's Customer
   * ownership rule (`resource.userId === principal.userId`).
   */
  findManyByUserId(userId: UserId, page: number, limit: number): Promise<ReservationListPage>;
}

export const RESERVATION_REPOSITORY = Symbol('RESERVATION_REPOSITORY');
