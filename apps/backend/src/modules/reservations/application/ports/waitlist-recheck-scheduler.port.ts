/**
 * Phase 7.5 architecture freeze item 6/9 (Blocker B resolution, 2026-07-24) -
 * Reservations' own outbound port for triggering a durable, best-effort
 * Waitlist re-check after a capacity-changing action, mirroring how
 * `ReservationExpirationSchedulerPort` (Phase 7.3) is Reservations' own
 * outbound port for its own scheduling need. Owned here (the consumer/
 * producer side), implemented by `BullMqWaitlistRecheckScheduler`
 * (also within this module - see that file's own doc comment for why this
 * avoids a circular NestJS module dependency with `WaitlistModule`).
 *
 * Called only from `CancelReservationUseCase` (the `Approved -> Cancelled`
 * branch) and `MarkNoShowReservationUseCase`, after their own transaction has
 * already committed, wrapped in a `try/catch` that logs on failure but never
 * fails the originating Cancel/NoShow response (freeze item 9: the original
 * lifecycle action never depends on successful promotion).
 */
export interface WaitlistRecheckSchedulerPort {
  enqueueRecheck(
    branchId: string,
    preferredDate: Date,
    organizationId: string | null,
    correlationId?: string,
  ): Promise<void>;
}

export const WAITLIST_RECHECK_SCHEDULER = Symbol('WAITLIST_RECHECK_SCHEDULER');
