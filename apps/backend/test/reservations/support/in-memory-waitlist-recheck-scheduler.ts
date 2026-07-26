import { WaitlistRecheckSchedulerPort } from '@modules/reservations/application/ports/waitlist-recheck-scheduler.port';

export class InMemoryWaitlistRecheckScheduler implements WaitlistRecheckSchedulerPort {
  public readonly enqueued: Array<{
    branchId: string;
    preferredDate: Date;
    organizationId: string | null;
    correlationId?: string;
  }> = [];

  async enqueueRecheck(
    branchId: string,
    preferredDate: Date,
    organizationId: string | null,
    correlationId?: string,
  ): Promise<void> {
    this.enqueued.push({ branchId, preferredDate, organizationId, correlationId });
  }
}
