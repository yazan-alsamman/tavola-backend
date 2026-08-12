import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NotificationBroadcastFanoutSchedulerPort } from '@modules/notifications/application/ports/notification-broadcast-fanout-scheduler.port';
import {
  NOTIFICATION_BROADCAST_FANOUT_JOB_NAME,
  NOTIFICATION_BROADCAST_MAX_ATTEMPTS,
  NotificationBroadcastFanoutJobData,
} from './notification-broadcast-queue.constants';
import { NOTIFICATION_QUEUE_NAME } from './notification-queue.constants';

const JOB_OPTS = {
  attempts: NOTIFICATION_BROADCAST_MAX_ATTEMPTS,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: true,
  removeOnFail: true,
};

@Injectable()
export class BullMqNotificationBroadcastFanoutScheduler implements NotificationBroadcastFanoutSchedulerPort {
  constructor(
    @InjectQueue(NOTIFICATION_QUEUE_NAME)
    private readonly queue: Queue<NotificationBroadcastFanoutJobData>,
  ) {}

  async enqueueFanout(broadcastId: string, correlationId?: string): Promise<void> {
    await this.queue.add(
      NOTIFICATION_BROADCAST_FANOUT_JOB_NAME,
      { broadcastId, correlationId },
      { ...JOB_OPTS, jobId: `notification-broadcast-${broadcastId}` },
    );
  }

  async enqueueContinuation(
    broadcastId: string,
    cursor: string,
    correlationId?: string,
  ): Promise<void> {
    await this.queue.add(
      NOTIFICATION_BROADCAST_FANOUT_JOB_NAME,
      { broadcastId, correlationId },
      { ...JOB_OPTS, jobId: `notification-broadcast-${broadcastId}-from-${cursor}` },
    );
  }
}
