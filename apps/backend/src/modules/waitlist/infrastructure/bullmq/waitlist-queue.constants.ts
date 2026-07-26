/**
 * Phase 7.5 - the Waitlist module's own delayed-expiration queue, direct
 * structural mirror of `RESERVATION_QUEUE_NAME`/`ExpireReservationJobData`
 * (Phase 7.3 precedent).
 */
export const WAITLIST_QUEUE_NAME = 'WaitlistQueue';

export const EXPIRE_WAITLIST_ENTRY_JOB_NAME = 'expire-waitlist-entry';

export interface ExpireWaitlistEntryJobData {
  entryId: string;
  organizationId: string | null;
  correlationId?: string;
}
