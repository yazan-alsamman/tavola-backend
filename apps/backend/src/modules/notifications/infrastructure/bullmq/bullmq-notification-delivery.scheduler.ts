import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NotificationDeliverySchedulerPort } from '@modules/notifications/application/ports/notification-delivery-scheduler.port';
import {
  NOTIFICATION_DELIVERY_JOB_NAME,
  NOTIFICATION_PUSH_MAX_ATTEMPTS,
  NOTIFICATION_QUEUE_NAME,
  NotificationDeliveryJobData,
} from './notification-queue.constants';

/**
 * `jobId` is stable per notification (`notification-push-{id}`) - a
 * duplicate `enqueueDelivery` call for the same notification (there is none
 * today; `NotificationDispatcher` calls this exactly once per Notification)
 * would be a safe idempotent replace, not a duplicate job, mirroring
 * `BullMqWaitlistExpirationScheduler`'s own `queue.remove` + `queue.add`
 * precedent - `add` with an existing `jobId` is itself already a no-op/
 * replace in BullMQ for a job that hasn't started, so no explicit `remove`
 * is needed here.
 */
@Injectable()
export class BullMqNotificationDeliveryScheduler implements NotificationDeliverySchedulerPort {
  constructor(
    @InjectQueue(NOTIFICATION_QUEUE_NAME)
    private readonly queue: Queue<NotificationDeliveryJobData>,
  ) {}

  async enqueueDelivery(notificationId: string, correlationId?: string): Promise<void> {
    await this.queue.add(
      NOTIFICATION_DELIVERY_JOB_NAME,
      { notificationId, correlationId },
      {
        jobId: `notification-push-${notificationId}`,
        attempts: NOTIFICATION_PUSH_MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}
