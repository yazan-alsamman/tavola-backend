/**
 * Phase 20.X (ADR-014 execution) - schedules/cancels the BullMQ delayed job
 * that anonymizes a User's account once its grace period elapses, mirroring
 * `SubscriptionExpirationSchedulerPort` exactly.
 */
export interface AccountDeletionSchedulerPort {
  /** Schedules (or re-schedules, replacing any existing job for the same User) a delayed job to fire at `anonymizeAt`. */
  scheduleAnonymization(userId: string, anonymizeAt: Date, correlationId?: string): Promise<void>;

  /** Removes any pending delayed job - called by CancelAccountDeletionUseCase. A safe no-op if no job exists. */
  cancelAnonymization(userId: string): Promise<void>;
}

export const ACCOUNT_DELETION_SCHEDULER = Symbol('ACCOUNT_DELETION_SCHEDULER');
