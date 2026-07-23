/**
 * EVENTS.md's "BullMQ Queue Events" section names `ReservationQueue` as one
 * of the seven platform queues - this is its first real consumer (no
 * business module had registered any queue before Phase 7.3).
 */
export const RESERVATION_QUEUE_NAME = 'ReservationQueue';

export const EXPIRE_RESERVATION_JOB_NAME = 'expire-pending-reservation';

/**
 * CODING_STANDARDS.md: "Job payloads must always include `organizationId`
 * explicitly." `organizationId` is `null` for a Customer-created reservation
 * (no Organization context), matching `TenantContext`'s own documented
 * null-tolerance - present as a field either way, never omitted.
 */
export interface ExpireReservationJobData {
  reservationId: string;
  organizationId: string | null;
  correlationId?: string;
}
