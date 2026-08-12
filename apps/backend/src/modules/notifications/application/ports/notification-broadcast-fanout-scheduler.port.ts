/**
 * Abstracts the BullMQ `NotificationQueue` fan-out job away from the
 * application layer, mirroring `NotificationDeliverySchedulerPort`'s
 * existing precedent (Phase 19.9, ADR-037).
 */
export interface NotificationBroadcastFanoutSchedulerPort {
  /** The kickoff job for a brand-new broadcast - `jobId: notification-broadcast-{broadcastId}`. */
  enqueueFanout(broadcastId: string, correlationId?: string): Promise<void>;

  /**
   * Enqueued by `ProcessNotificationBroadcastFanoutUseCase` itself when a job
   * run's batch budget is exhausted before the audience is -
   * `jobId: notification-broadcast-{broadcastId}-from-{cursor}`, deterministic
   * per cursor value so a retried run that reaches the same point never
   * double-enqueues a genuinely duplicate continuation.
   */
  enqueueContinuation(broadcastId: string, cursor: string, correlationId?: string): Promise<void>;
}

export const NOTIFICATION_BROADCAST_FANOUT_SCHEDULER = Symbol(
  'NOTIFICATION_BROADCAST_FANOUT_SCHEDULER',
);
