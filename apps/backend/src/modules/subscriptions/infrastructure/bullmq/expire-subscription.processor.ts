import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ExpireSubscriptionUseCase } from '@modules/subscriptions/application/use-cases/expire-subscription.use-case';
import {
  ExpireSubscriptionJobData,
  SUBSCRIPTION_EXPIRATION_QUEUE_NAME,
} from './subscription-queue.constants';

/**
 * Phase 12 (Subscriptions) - the sole consumer of
 * `SubscriptionExpirationQueue`. Delegates entirely to
 * `ExpireSubscriptionUseCase`, mirroring `ExpireOfferProcessor` exactly.
 */
@Processor(SUBSCRIPTION_EXPIRATION_QUEUE_NAME)
export class ExpireSubscriptionProcessor extends WorkerHost {
  constructor(private readonly expireSubscriptionUseCase: ExpireSubscriptionUseCase) {
    super();
  }

  async process(job: Job<ExpireSubscriptionJobData>): Promise<void> {
    await this.expireSubscriptionUseCase.execute(job.data);
  }
}
