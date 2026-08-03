import { OfferExpirationSchedulerPort } from '@modules/offers/application/ports/offer-expiration-scheduler.port';

export class InMemoryOfferExpirationScheduler implements OfferExpirationSchedulerPort {
  public readonly scheduled = new Map<
    string,
    { organizationId: string; expireAt: Date; correlationId?: string }
  >();
  public readonly cancelledOfferIds: string[] = [];

  async scheduleExpiration(
    offerId: string,
    organizationId: string,
    expireAt: Date,
    correlationId?: string,
  ): Promise<void> {
    this.scheduled.set(offerId, { organizationId, expireAt, correlationId });
  }

  async cancelExpiration(offerId: string): Promise<void> {
    this.cancelledOfferIds.push(offerId);
    this.scheduled.delete(offerId);
  }
}
