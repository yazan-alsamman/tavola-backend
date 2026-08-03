import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OfferExpirationSchedulerPort } from '@modules/offers/application/ports/offer-expiration-scheduler.port';
import {
  EXPIRE_OFFER_JOB_NAME,
  ExpireOfferJobData,
  OFFER_EXPIRATION_QUEUE_NAME,
} from './offer-queue.constants';

/**
 * Phase 11 (Offers) - the BullMQ-backed adapter for
 * `OfferExpirationSchedulerPort`, mirroring
 * `BullMqReservationExpirationScheduler` exactly: `scheduleExpiration`
 * always removes any existing job for the same Offer first (defensive - in
 * practice an Offer is only ever published once, since Publish requires
 * Draft), and `removeOnComplete`/`removeOnFail` keep the queue from
 * accumulating terminal job records indefinitely.
 */
@Injectable()
export class BullMqOfferExpirationScheduler implements OfferExpirationSchedulerPort {
  constructor(
    @InjectQueue(OFFER_EXPIRATION_QUEUE_NAME)
    private readonly queue: Queue<ExpireOfferJobData>,
  ) {}

  async scheduleExpiration(
    offerId: string,
    organizationId: string,
    expireAt: Date,
    correlationId?: string,
  ): Promise<void> {
    const jobId = this.jobId(offerId);
    await this.queue.remove(jobId);
    const delay = Math.max(0, expireAt.getTime() - Date.now());
    await this.queue.add(
      EXPIRE_OFFER_JOB_NAME,
      { offerId, organizationId, correlationId },
      { jobId, delay, removeOnComplete: true, removeOnFail: true },
    );
  }

  async cancelExpiration(offerId: string): Promise<void> {
    await this.queue.remove(this.jobId(offerId));
  }

  private jobId(offerId: string): string {
    // BullMQ rejects a custom job id containing `:` (its own internal Redis
    // key delimiter) - `-` avoids that, matching every other scheduler here.
    return `expire-offer-${offerId}`;
  }
}
