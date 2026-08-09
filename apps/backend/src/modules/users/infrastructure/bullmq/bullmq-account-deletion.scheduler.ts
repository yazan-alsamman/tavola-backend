import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AccountDeletionSchedulerPort } from '../../application/ports/account-deletion-scheduler.port';
import {
  ACCOUNT_DELETION_QUEUE_NAME,
  ANONYMIZE_USER_ACCOUNT_JOB_NAME,
  AnonymizeUserAccountJobData,
} from './account-deletion-queue.constants';

/**
 * Phase 20.X (ADR-014 execution) - the BullMQ-backed adapter for
 * `AccountDeletionSchedulerPort`, mirroring
 * `BullMqSubscriptionExpirationScheduler` exactly, including its
 * deterministic-`jobId`-per-entity reschedule/cancel pattern.
 */
@Injectable()
export class BullMqAccountDeletionScheduler implements AccountDeletionSchedulerPort {
  constructor(
    @InjectQueue(ACCOUNT_DELETION_QUEUE_NAME)
    private readonly queue: Queue<AnonymizeUserAccountJobData>,
  ) {}

  async scheduleAnonymization(
    userId: string,
    anonymizeAt: Date,
    correlationId?: string,
  ): Promise<void> {
    const jobId = this.jobId(userId);
    await this.queue.remove(jobId);
    const delay = Math.max(0, anonymizeAt.getTime() - Date.now());
    await this.queue.add(
      ANONYMIZE_USER_ACCOUNT_JOB_NAME,
      { userId, correlationId },
      { jobId, delay, removeOnComplete: true, removeOnFail: true },
    );
  }

  async cancelAnonymization(userId: string): Promise<void> {
    await this.queue.remove(this.jobId(userId));
  }

  private jobId(userId: string): string {
    return `anonymize-user-account-${userId}`;
  }
}
