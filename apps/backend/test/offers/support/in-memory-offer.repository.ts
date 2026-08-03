import { Offer } from '@modules/offers/domain/entities/offer.entity';
import { OfferStatus } from '@modules/offers/domain/enums/offer.enums';
import {
  OfferListPage,
  OfferRepository,
} from '@modules/offers/domain/repositories/offer.repository';
import { OfferId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * Faithfully reproduces the real `PrismaOfferRepository`'s CAS semantics
 * (`updateIfDraft`/`publishIfDraft`/`expireIfPublished` only apply if the
 * row is still in the expected state at write time) so unit tests can prove
 * race behavior without a real database.
 */
export class InMemoryOfferRepository implements OfferRepository {
  private readonly rows = new Map<string, Offer>();

  async create(offer: Offer): Promise<void> {
    this.rows.set(offer.offerId.value, offer);
  }

  async findByIdAndRestaurantId(id: OfferId, restaurantId: RestaurantId): Promise<Offer | null> {
    const row = this.rows.get(id.value);
    if (!row || row.isDeleted() || row.restaurantId.value !== restaurantId.value) {
      return null;
    }
    return row;
  }

  async findById(id: OfferId): Promise<Offer | null> {
    const row = this.rows.get(id.value);
    if (!row || row.isDeleted()) {
      return null;
    }
    return row;
  }

  async updateIfDraft(offer: Offer): Promise<boolean> {
    const current = this.rows.get(offer.offerId.value);
    if (!current || current.status !== OfferStatus.Draft) {
      return false;
    }
    this.rows.set(offer.offerId.value, offer);
    return true;
  }

  async publishIfDraft(offer: Offer): Promise<boolean> {
    const current = this.rows.get(offer.offerId.value);
    if (!current || current.status !== OfferStatus.Draft) {
      return false;
    }
    this.rows.set(offer.offerId.value, offer);
    return true;
  }

  async expireIfPublished(id: OfferId, at: Date): Promise<boolean> {
    const current = this.rows.get(id.value);
    if (!current || current.status !== OfferStatus.Published || current.isDeleted()) {
      return false;
    }
    this.rows.set(id.value, current.expire(at));
    return true;
  }

  async softDelete(id: OfferId, at: Date): Promise<void> {
    const current = this.rows.get(id.value);
    if (!current || current.isDeleted()) {
      return;
    }
    this.rows.set(id.value, current.softDelete(at));
  }

  async findManyByRestaurantId(
    restaurantId: RestaurantId,
    page: number,
    limit: number,
  ): Promise<OfferListPage> {
    const all = [...this.rows.values()]
      .filter((row) => row.restaurantId.value === restaurantId.value && !row.isDeleted())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (page - 1) * limit;
    return { items: all.slice(start, start + limit), total: all.length };
  }

  async findManyPublicByRestaurantId(
    restaurantId: RestaurantId,
    now: Date,
    page: number,
    limit: number,
  ): Promise<OfferListPage> {
    const all = [...this.rows.values()]
      .filter((row) => row.restaurantId.value === restaurantId.value && row.isPubliclyActive(now))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (page - 1) * limit;
    return { items: all.slice(start, start + limit), total: all.length };
  }

  async findRestaurantIdsWithActivePublicOffer(
    restaurantIds: RestaurantId[],
    now: Date,
  ): Promise<Set<string>> {
    const wanted = new Set(restaurantIds.map((id) => id.value));
    const found = new Set<string>();
    for (const row of this.rows.values()) {
      if (wanted.has(row.restaurantId.value) && row.isPubliclyActive(now)) {
        found.add(row.restaurantId.value);
      }
    }
    return found;
  }

  /** Test-only helper: seeds a row directly. */
  seed(offer: Offer): void {
    this.rows.set(offer.offerId.value, offer);
  }
}
