import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ProcessNotificationDeliveryUseCase } from '@modules/notifications/application/use-cases/process-notification-delivery.use-case';
import {
  NOTIFICATION_QUEUE_NAME,
  NotificationDeliveryJobData,
} from './notification-queue.constants';

/**
 * `NotificationQueue`'s sole consumer - delegates entirely to
 * `ProcessNotificationDeliveryUseCase`, mirroring
 * `ExpireWaitlistEntryProcessor`'s established one-processor-one-use-case
 * precedent. `isFinalAttempt` tells the use case whether a
 * `retryableFailure` provider outcome should be rethrown (to let BullMQ's
 * own backoff retry the job) or written `Failed` (attempts exhausted).
 */
@Processor(NOTIFICATION_QUEUE_NAME)
export class NotificationDeliveryProcessor extends WorkerHost {
  constructor(
    private readonly processNotificationDeliveryUseCase: ProcessNotificationDeliveryUseCase,
  ) {
    super();
  }

  async process(job: Job<NotificationDeliveryJobData>): Promise<void> {
    const attemptsConfigured = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= attemptsConfigured;

    await this.processNotificationDeliveryUseCase.execute({
      notificationId: job.data.notificationId,
      isFinalAttempt,
      correlationId: job.data.correlationId,
    });
  }
}
