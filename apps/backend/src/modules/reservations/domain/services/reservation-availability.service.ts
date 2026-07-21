/**
 * DOMAIN_MODEL.md: "ReservationAvailabilityService — computes availability
 * and, per ADR-013, owns the advisory-lock-key derivation `(branchId,
 * tableId, date, timeSlotBucket)` used to serialize conflicting reservation
 * attempts. Framework-independent: the domain service defines *what* must be
 * locked and *why*; the Infrastructure-layer repository implementation is
 * responsible for actually acquiring the PostgreSQL advisory lock."
 */
export class ReservationAvailabilityService {
  /**
   * Buckets a reservation start time to the restaurant's configured
   * `reservationIntervalMinutes` (ADR-013's "time-slot bucketing") - two
   * reservations in the same bucket contend for the same advisory lock key;
   * genuinely non-overlapping buckets do not block each other.
   */
  static deriveTimeSlotBucket(startTime: Date, reservationIntervalMinutes: number): number {
    const minutesSinceMidnight = startTime.getUTCHours() * 60 + startTime.getUTCMinutes();
    return Math.floor(minutesSinceMidnight / reservationIntervalMinutes);
  }

  /**
   * The composite lock-key string `(branchId, tableId, date, timeSlotBucket)`
   * - the infrastructure repository is the only layer that actually calls
   * `hashtextextended(key, 0)` / `pg_advisory_xact_lock`.
   */
  static deriveLockKey(
    branchId: string,
    tableId: string,
    reservationDate: Date,
    timeSlotBucket: number,
  ): string {
    const dateOnly = reservationDate.toISOString().slice(0, 10);
    return `${branchId}:${tableId}:${dateOnly}:${timeSlotBucket}`;
  }
}
