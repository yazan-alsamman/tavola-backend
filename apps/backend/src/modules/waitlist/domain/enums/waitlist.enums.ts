/**
 * Phase 7.5 (Reservation Waitlist, ADR-019) - frozen state machine (Phase 7.5
 * architecture freeze item 6): `Waiting -> {Notified, Converted, Cancelled,
 * Expired}`, `Notified -> {Converted, Cancelled, Expired}`. `Converted`/
 * `Cancelled`/`Expired` are terminal. `Notified -> Waiting` is explicitly not
 * allowed.
 */
export enum WaitlistStatus {
  Waiting = 'Waiting',
  Notified = 'Notified',
  Converted = 'Converted',
  Cancelled = 'Cancelled',
  Expired = 'Expired',
}
