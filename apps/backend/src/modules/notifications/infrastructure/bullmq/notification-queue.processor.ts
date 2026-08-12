import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ProcessNotificationDeliveryUseCase } from '@modules/notifications/application/use-cases/process-notification-delivery.use-case';
import { ProcessNotificationBroadcastFanoutUseCase } from '@modules/notifications/application/use-cases/process-notification-broadcast-fanout.use-case';
import {
  NOTIFICATION_DELIVERY_JOB_NAME,
  NOTIFICATION_QUEUE_NAME,
  NotificationDeliveryJobData,
} from './notification-queue.constants';
import {
  NOTIFICATION_BROADCAST_FANOUT_JOB_NAME,
  NotificationBroadcastFanoutJobData,
} from './notification-broadcast-queue.constants';

type NotificationQueueJobData = NotificationDeliveryJobData | NotificationBroadcastFanoutJobData;

/**
 * `NotificationQueue`'s single Worker (Phase 9 + Phase 19.9/ADR-037). A
 * BullMQ `Worker` competes for every job on its bound queue regardless of
 * job name - two separate `@Processor(NOTIFICATION_QUEUE_NAME)` classes
 * would each spin up their own competing Worker and non-deterministically
 * steal each other's jobs, silently no-op-ing whichever job name they don't
 * recognize (a real correctness bug, not just a style choice). One processor
 * dispatching on `job.name`, delegating entirely to the matching use case,
 * is therefore required, not merely preferred - mirroring the one-worker-
 * per-queue shape every other multi-job-name queue in this codebase already
 * uses.
 */
@Processor(NOTIFICATION_QUEUE_NAME)
export class NotificationQueueProcessor extends WorkerHost {
  constructor(
    private readonly processNotificationDeliveryUseCase: ProcessNotificationDeliveryUseCase,
    private readonly processNotificationBroadcastFanoutUseCase: ProcessNotificationBroadcastFanoutUseCase,
  ) {
    super();
  }

  async process(job: Job<NotificationQueueJobData>): Promise<void> {
    const attemptsConfigured = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= attemptsConfigured;

    if (job.name === NOTIFICATION_DELIVERY_JOB_NAME) {
      const data = job.data as NotificationDeliveryJobData;
      await this.processNotificationDeliveryUseCase.execute({
        notificationId: data.notificationId,
        isFinalAttempt,
        correlationId: data.correlationId,
      });
      return;
    }

    if (job.name === NOTIFICATION_BROADCAST_FANOUT_JOB_NAME) {
      const data = job.data as NotificationBroadcastFanoutJobData;
      await this.processNotificationBroadcastFanoutUseCase.execute({
        broadcastId: data.broadcastId,
        isFinalAttempt,
        correlationId: data.correlationId,
      });
      return;
    }

    // Default-deny: an unrecognized job name on this queue is a programmer
    // error (a job scheduler/queue name mismatch), never silently dropped.
    throw new Error(`NotificationQueueProcessor: unrecognized job name "${job.name}".`);
  }
}
