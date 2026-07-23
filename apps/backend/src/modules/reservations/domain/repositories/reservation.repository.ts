import { Reservation } from '../entities/reservation.entity';
import { ReservationStatus } from '../enums/reservation.enums';
import { ReservationId, TableId } from '@shared/domain/value-objects/identifiers.vo';

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
   * `updatedAt`) from the given entity's current in-memory state. Same
   * `true`/`false`/`ReservationConflictException` semantics as
   * `updateTransitioningFromPending`.
   */
  updateTransitioningFrom(
    reservation: Reservation,
    expectedCurrentStatus: ReservationStatus,
  ): Promise<boolean>;
}

export const RESERVATION_REPOSITORY = Symbol('RESERVATION_REPOSITORY');
