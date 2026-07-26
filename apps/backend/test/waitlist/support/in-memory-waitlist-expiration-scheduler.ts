import { WaitlistExpirationSchedulerPort } from '@modules/waitlist/application/ports/waitlist-expiration-scheduler.port';

export class InMemoryWaitlistExpirationScheduler implements WaitlistExpirationSchedulerPort {
  public readonly scheduled = new Map<
    string,
    { organizationId: string | null; expiresAt: Date; correlationId?: string }
  >();
  public readonly cancelledEntryIds: string[] = [];

  async scheduleExpiration(
    entryId: string,
    organizationId: string | null,
    expiresAt: Date,
    correlationId?: string,
  ): Promise<void> {
    this.scheduled.set(entryId, { organizationId, expiresAt, correlationId });
  }

  async cancelExpiration(entryId: string): Promise<void> {
    this.cancelledEntryIds.push(entryId);
    this.scheduled.delete(entryId);
  }
}
