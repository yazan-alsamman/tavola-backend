/**
 * Phase 7.3 (Reservation Lifecycle) - schedules/cancels the BullMQ delayed
 * job that transitions a `Pending` reservation to `Expired`
 * (`RestaurantSettings.pendingReservationTimeoutMinutes` after its
 * `reservationStartTime`). CODING_STANDARDS.md requires every BullMQ job
 * payload to carry `organizationId` explicitly (even when `null` - a
 * Customer-created reservation has none, matching `TenantContext`'s own
 * documented null-tolerance) so the job handler can establish Tenant
 * Context as its first line.
 */
export interface ReservationExpirationSchedulerPort {
  /**
   * Schedules (or re-schedules, replacing any existing job for the same
   * reservation) a delayed job to fire at `expireAt`.
   */
  scheduleExpiration(
    reservationId: string,
    organizationId: string | null,
    expireAt: Date,
    correlationId?: string,
  ): Promise<void>;

  /**
   * Removes any pending delayed job for this reservation - called whenever
   * the reservation transitions away from `Pending` before the job fires
   * (Approve/Reject/Cancel), or is rescheduled (the old job is cancelled and
   * a new one scheduled for the new window via `scheduleExpiration`).
   * A safe no-op if no job exists.
   */
  cancelExpiration(reservationId: string): Promise<void>;
}

export const RESERVATION_EXPIRATION_SCHEDULER = Symbol('RESERVATION_EXPIRATION_SCHEDULER');
