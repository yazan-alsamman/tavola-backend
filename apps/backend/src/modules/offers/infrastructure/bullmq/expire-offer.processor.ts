import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ExpireOfferUseCase } from '@modules/offers/application/use-cases/expire-offer.use-case';
import { ExpireOfferJobData, OFFER_EXPIRATION_QUEUE_NAME } from './offer-queue.constants';

/**
 * Phase 11 (Offers) - the sole consumer of `OfferExpirationQueue`. Delegates
 * entirely to `ExpireOfferUseCase`, which establishes Tenant Context from
 * the job payload as its own first line (CODING_STANDARDS.md) and is itself
 * idempotent (CAS-guarded, safe to replay) - this processor has no business
 * logic of its own, mirroring `ExpireReservationProcessor` exactly.
 */
@Processor(OFFER_EXPIRATION_QUEUE_NAME)
export class ExpireOfferProcessor extends WorkerHost {
  constructor(private readonly expireOfferUseCase: ExpireOfferUseCase) {
    super();
  }

  async process(job: Job<ExpireOfferJobData>): Promise<void> {
    await this.expireOfferUseCase.execute(job.data);
  }
}
