import { OfferViewDedupePort } from '@modules/offers/application/ports/offer-view-dedupe.port';

export class InMemoryOfferViewDedupe implements OfferViewDedupePort {
  private readonly seen = new Set<string>();

  async claimFirstViews(offerIds: string[], viewerKey: string, now: Date): Promise<string[]> {
    const day = now.toISOString().slice(0, 10);
    return offerIds.filter((offerId) => {
      const key = `${day}:${offerId}:${viewerKey}`;
      if (this.seen.has(key)) {
        return false;
      }
      this.seen.add(key);
      return true;
    });
  }
}
