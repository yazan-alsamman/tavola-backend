import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SubscriptionExpirationSchedulerPort } from '@modules/subscriptions/application/ports/subscription-expiration-scheduler.port';
import {
  EXPIRE_SUBSCRIPTION_JOB_NAME,
  ExpireSubscriptionJobData,
  SUBSCRIPTION_EXPIRATION_QUEUE_NAME,
} from './subscription-queue.constants';

/**
 * Phase 12 (Subscriptions) - the BullMQ-backed adapter for
 * `SubscriptionExpirationSchedulerPort`, mirroring
 * `BullMqOfferExpirationScheduler` exactly.
 */
@Injectable()
export class BullMqSubscriptionExpirationScheduler implements SubscriptionExpirationSchedulerPort {
  constructor(
    @InjectQueue(SUBSCRIPTION_EXPIRATION_QUEUE_NAME)
    private readonly queue: Queue<ExpireSubscriptionJobData>,
  ) {}

  async scheduleExpiration(
    subscriptionId: string,
    organizationId: string,
    expireAt: Date,
    correlationId?: string,
  ): Promise<void> {
    const jobId = this.jobId(subscriptionId);
    await this.queue.remove(jobId);
    const delay = Math.max(0, expireAt.getTime() - Date.now());
    await this.queue.add(
      EXPIRE_SUBSCRIPTION_JOB_NAME,
      { subscriptionId, organizationId, correlationId },
      { jobId, delay, removeOnComplete: true, removeOnFail: true },
    );
  }

  async cancelExpiration(subscriptionId: string): Promise<void> {
    await this.queue.remove(this.jobId(subscriptionId));
  }

  private jobId(subscriptionId: string): string {
    return `expire-subscription-${subscriptionId}`;
  }
}
