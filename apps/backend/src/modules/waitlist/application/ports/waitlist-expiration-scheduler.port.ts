/**
 * Phase 7.5 - schedules/cancels the BullMQ delayed job that expires a
 * `Waiting`/`Notified` waitlist entry (end of `preferredDate` in
 * `Branch.timezone`). Direct structural mirror of
 * `ReservationExpirationSchedulerPort` (Phase 7.3 precedent).
 */
export interface WaitlistExpirationSchedulerPort {
  scheduleExpiration(
    entryId: string,
    organizationId: string | null,
    expiresAt: Date,
    correlationId?: string,
  ): Promise<void>;

  /** Safe no-op if no job exists - called on Cancel/Convert/re-schedule. */
  cancelExpiration(entryId: string): Promise<void>;
}

export const WAITLIST_EXPIRATION_SCHEDULER = Symbol('WAITLIST_EXPIRATION_SCHEDULER');
