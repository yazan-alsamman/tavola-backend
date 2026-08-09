import { ReservationWaitlistEntry } from '../entities/reservation-waitlist-entry.entity';
import { WaitlistStatus } from '../enums/waitlist.enums';
import { BranchId, UserId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * `ReservationWaitlistEntry` carries a direct `organizationId` column but is
 * deliberately NOT registered in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (Phase 7.5 architecture freeze item 14,
 * matching `Reservation`'s own precedent) - tenant/branch-scope validation is
 * the caller's responsibility (resolve Branch/Restaurant first), exactly like
 * every other Reservation-adjacent repository in this codebase.
 */
export interface ReservationWaitlistEntryRepository {
  findById(id: string): Promise<ReservationWaitlistEntry | null>;

  /**
   * `pg_advisory_xact_lock(hashtextextended(key, 0))` keyed by
   * `waitlist:{branchId}:{preferredDate}` - the same technique ADR-013
   * established for Reservation creation, generalized to a new lock
   * namespace (Phase 7.5 §9), not a reuse of ADR-013's own key. Must be
   * called inside an active transaction, immediately before
   * `findMaxPositionForScope`/`createInTransaction` - released automatically
   * at commit/rollback.
   */
  acquireQueueLock(branchId: BranchId, preferredDate: Date): Promise<void>;

  /**
   * Inserts a new entry inside the caller's own transaction. The caller is
   * responsible for having already acquired the branch+preferredDate
   * advisory lock and computed a fresh `position` under it (see
   * `JoinWaitlistUseCase`) - this method performs no locking of its own.
   * Throws `WaitlistPositionConflictException` if the partial unique
   * active-position index is violated (a genuine race despite the advisory
   * lock).
   */
  createInTransaction(entry: ReservationWaitlistEntry): Promise<void>;

  /**
   * The current `MAX(position)` for `(branchId, preferredDate)` among
   * non-deleted rows, or `0` if none exist yet - must be called inside the
   * same transaction as the branch+preferredDate advisory lock, immediately
   * before `createInTransaction`.
   */
  findMaxPositionForScope(branchId: BranchId, preferredDate: Date): Promise<number>;

  /**
   * FIFO-ordered (`position` ascending) active (`Waiting`/`Notified`)
   * entries for `(branchId, preferredDate)` - the promotion re-check scan
   * order (Phase 7.5 final FIFO-fairness decision, 2026-07-24:
   * FIFO-ordered-first-serviceable).
   */
  findActiveByBranchAndDateOrderedByPosition(
    branchId: BranchId,
    preferredDate: Date,
  ): Promise<ReservationWaitlistEntry[]>;

  /**
   * The same conditional `UPDATE ... WHERE id = ? AND status = ?` pattern as
   * `ReservationRepository.updateTransitioningFrom` - returns `true` if the
   * row was still `expectedCurrentStatus` and the update applied, `false` if
   * a concurrent writer already moved it away (claim race, duplicate/replayed
   * job, etc.). This is the sole concurrency guard for expiration and
   * Cancel. NOT used for the promotion claim itself - see `claimStatusOnly`.
   */
  updateTransitioningFrom(
    entry: ReservationWaitlistEntry,
    expectedCurrentStatus: WaitlistStatus,
  ): Promise<boolean>;

  /**
   * The FIRST half of `WaitlistPromotionService`'s two-phase claim: the same
   * conditional `UPDATE ... WHERE id = ? AND status = ?` guard as
   * `updateTransitioningFrom`, but touching ONLY `status`/`updatedAt` -
   * deliberately never `convertedReservationId`. Required because
   * `reservation_waitlist_entries_converted_reservation_id_fkey` is a real
   * FK to `reservations.id`, and the target `Reservation` row does not exist
   * yet at claim time (it is pre-generated but only inserted after the claim
   * succeeds, per the frozen promotion transaction order) - writing a
   * not-yet-existing id into that column would violate the FK. Returns
   * `true` if the row was still `expectedCurrentStatus` and the claim
   * applied (this is the actual "only one concurrent attempt wins" gate),
   * `false` otherwise. The caller finalizes with `updateTransitioningFrom`
   * (guarded by the now-current `Converted` status) once the Reservation
   * row exists, to set `convertedReservationId` in the same transaction.
   */
  claimStatusOnly(
    id: string,
    targetStatus: WaitlistStatus,
    expectedCurrentStatus: WaitlistStatus,
    updatedAt: Date,
  ): Promise<boolean>;

  /**
   * Phase 20.X (ADR-014 execution) - `RequestAccountDeletionUseCase`'s
   * auto-cancel-on-delete pass. Same active-status definition as
   * `findActiveByBranchAndDateOrderedByPosition` (`Waiting`/`Notified`,
   * non-deleted) - order is irrelevant here, every result is cancelled.
   */
  findActiveByUserId(userId: UserId): Promise<ReservationWaitlistEntry[]>;
}

export const RESERVATION_WAITLIST_ENTRY_REPOSITORY = Symbol(
  'RESERVATION_WAITLIST_ENTRY_REPOSITORY',
);
