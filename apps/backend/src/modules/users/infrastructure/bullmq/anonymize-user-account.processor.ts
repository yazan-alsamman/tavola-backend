import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AnonymizeUserAccountUseCase } from '../../application/use-cases/anonymize-user-account.use-case';
import {
  ACCOUNT_DELETION_QUEUE_NAME,
  AnonymizeUserAccountJobData,
} from './account-deletion-queue.constants';

/**
 * Phase 20.X (ADR-014 execution) - the sole consumer of
 * `AccountDeletionQueue`. Delegates entirely to `AnonymizeUserAccountUseCase`,
 * mirroring `ExpireSubscriptionProcessor` exactly.
 */
@Processor(ACCOUNT_DELETION_QUEUE_NAME)
export class AnonymizeUserAccountProcessor extends WorkerHost {
  constructor(private readonly anonymizeUserAccountUseCase: AnonymizeUserAccountUseCase) {
    super();
  }

  async process(job: Job<AnonymizeUserAccountJobData>): Promise<void> {
    await this.anonymizeUserAccountUseCase.execute(job.data);
  }
}
