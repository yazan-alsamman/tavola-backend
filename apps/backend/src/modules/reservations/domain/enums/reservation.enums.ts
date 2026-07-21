/**
 * Phase 7 architecture decision (TASKS.md "Phase 7 — Reservation Engine"
 * note, item 1): 7 values, frozen as one indivisible decision - unlike
 * `TableStatus`'s own incremental history. Phase 7.1 (Scope Amendment,
 * 2026-07-20) only ever produces `Pending` - no transition-validating method
 * exists yet; `Approved`/`Rejected`/`Cancelled`/`Completed`/`Expired`/`NoShow`
 * become reachable starting Phase 7.2.
 */
export enum ReservationStatus {
  Pending = 'Pending',
  Approved = 'Approved',
  Rejected = 'Rejected',
  Cancelled = 'Cancelled',
  Completed = 'Completed',
  Expired = 'Expired',
  NoShow = 'NoShow',
}

/**
 * DATABASE_SCHEMA.md "Reservations" Notes: "`source` enum includes at
 * minimum: Online, Phone, WalkIn, Staff, WaitlistConversion." Phase 7.1
 * (Online-only scope) only ever produces `Online` - Phone/WalkIn are Phase
 * 7.4, Staff/WaitlistConversion later still.
 */
export enum ReservationSource {
  Online = 'Online',
  Phone = 'Phone',
  WalkIn = 'WalkIn',
  Staff = 'Staff',
  WaitlistConversion = 'WaitlistConversion',
}
