/**
 * Abstracts `NotificationQueue` (BullMQ) away from the application layer -
 * mirrors `WaitlistExpirationSchedulerPort`/`ApprovedReservationOperationalSchedulerPort`'s
 * existing precedent of never letting a use case/service depend on
 * `@nestjs/bullmq` directly. Phase 9 decision item 13: `NotificationQueue`
 * delivery jobs carry no `organizationId` - `Notification` is `userId`-owned
 * only, never tenant-scoped (see `NotificationDeliveryJobData`'s own doc
 * comment).
 */
export interface NotificationDeliverySchedulerPort {
  /** Enqueues (or re-enqueues, replacing any existing job for the same notification) the push-delivery job. */
  enqueueDelivery(notificationId: string, correlationId?: string): Promise<void>;
}

export const NOTIFICATION_DELIVERY_SCHEDULER = Symbol('NOTIFICATION_DELIVERY_SCHEDULER');
