/**
 * Phase 7.5 architecture freeze item 9/Blocker-B resolution (2026-07-24):
 * `WaitlistRecheckQueue` is deliberately registered independently by BOTH
 * `ReservationsModule` (producer - `BullMqWaitlistRecheckScheduler`, owned by
 * Reservations' own outbound port) and `WaitlistModule` (consumer -
 * `WaitlistRecheckProcessor`) rather than either module importing the
 * other's Nest module. Two independent `@nestjs/bullmq` `Queue` client
 * instances, both bound to the same Redis-backed queue name via this one
 * shared constants file, is the standard BullMQ producer/consumer pattern -
 * not a circular NestJS module dependency. This is the concrete mechanism
 * behind the "direct synchronous service composition, not a new event bus"
 * automatic-trigger design (mirrors `AutoRejectOverlappingPendingReservationsService`'s
 * precedent for "one action triggers another domain operation", made
 * durable via BullMQ instead of a bare in-process call - see Blocker B's
 * resolution in the Phase 7.5 implementation plan).
 */
export const WAITLIST_RECHECK_QUEUE_NAME = 'WaitlistRecheckQueue';

export const RECHECK_WAITLIST_JOB_NAME = 'recheck-waitlist';

export interface RecheckWaitlistJobData {
  branchId: string;
  /** ISO date string (`YYYY-MM-DD`). */
  preferredDateIso: string;
  organizationId: string | null;
  correlationId?: string;
}
