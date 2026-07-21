import { Reservation } from '../entities/reservation.entity';
import { TableId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * `Reservation` carries `restaurantId`/`branchId` directly but is not in
 * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (customer-facing writes
 * are not organization-scoped the way admin CRUD is) - tenant validation for
 * Create Reservation is the caller's responsibility (resolve Restaurant/
 * Branch/Table first), exactly like every other transitively-tenant-owned
 * repository in this codebase.
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
   * atomic unit. Throws `ReservationConflictException` if a confirmed
   * overlap is found (not reachable via any Phase 7.1 code path today, since
   * Phase 7.1 never produces anything but `Pending` - see the exception's
   * own doc comment).
   */
  createWithLock(reservation: Reservation, lockKey: string): Promise<void>;
}

export const RESERVATION_REPOSITORY = Symbol('RESERVATION_REPOSITORY');
