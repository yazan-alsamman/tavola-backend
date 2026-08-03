import { Offer } from '../entities/offer.entity';
import { OfferId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

export interface OfferListPage {
  items: Offer[];
  total: number;
}

/**
 * `Offer` carries no `organizationId` column and is not in
 * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (TENANCY.md, Phase 11
 * architecture freeze) - tenant resolution for management operations is
 * transitive via `Offer.restaurantId -> Restaurant.organizationId`, resolved
 * by the calling use case through the already-tenant-scoped
 * `RestaurantRepository` first, exactly like `Review`. Every `findById`-style
 * method excludes soft-deleted rows (`deletedAt: null`) - a second delete/
 * update/publish attempt, or a lookup of an already-deleted Offer, naturally
 * collapses to "not found".
 */
export interface OfferRepository {
  create(offer: Offer): Promise<void>;

  /** Tenant-safe lookup for every management mutation (Update/Publish/Delete). */
  findByIdAndRestaurantId(id: OfferId, restaurantId: RestaurantId): Promise<Offer | null>;

  /** Used only by the BullMQ expiration job - no restaurant scope needed (System actor). */
  findById(id: OfferId): Promise<Offer | null>;

  /**
   * Conditional `UPDATE ... WHERE id = ? AND status = 'Draft'` - persists
   * every mutable content field. Returns `false` if a concurrent transition
   * (a second Update, or a Publish) already moved the Offer away from Draft
   * between the caller's read and this write.
   */
  updateIfDraft(offer: Offer): Promise<boolean>;

  /**
   * Conditional `UPDATE ... WHERE id = ? AND status = 'Draft'`, setting
   * `status = 'Published'`. Returns `false` on the same race as
   * `updateIfDraft`.
   */
  publishIfDraft(offer: Offer): Promise<boolean>;

  /**
   * The BullMQ expiration job's sole write - `UPDATE offers SET status =
   * 'Expired', updated_at = ? WHERE id = ? AND status = 'Published' AND
   * deleted_at IS NULL`. Returns `false` if the Offer is no longer Published
   * (already expired by a previous, retried execution of this same job; or
   * soft-deleted in the meantime) - the processor treats `false` as a safe
   * no-op, never an error, exactly like `markLateArrivalNotifiedIfEligible`.
   */
  expireIfPublished(id: OfferId, at: Date): Promise<boolean>;

  /** Soft delete (ADR-010) - a no-op (silently 0 rows affected) if already deleted. */
  softDelete(id: OfferId, at: Date): Promise<void>;

  /** Management listing - every status, paginated, newest-created first. */
  findManyByRestaurantId(
    restaurantId: RestaurantId,
    page: number,
    limit: number,
  ): Promise<OfferListPage>;

  /**
   * D5's public visibility predicate as a query: `status = 'Published' AND
   * starts_at <= now AND ends_at > now AND deleted_at IS NULL`, paginated,
   * newest-created first. Never depends on whether the expiration worker has
   * already run - an Offer past `endsAt` is excluded here directly.
   */
  findManyPublicByRestaurantId(
    restaurantId: RestaurantId,
    now: Date,
    page: number,
    limit: number,
  ): Promise<OfferListPage>;

  /**
   * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D9): bulk
   * form of the same public-active predicate `findManyPublicByRestaurantId`
   * already owns (`status = 'Published' AND starts_at <= now AND ends_at >
   * now AND deleted_at IS NULL`), grouped by restaurant - lets Discovery
   * annotate `hasActiveOffer` on a whole result page in one query instead of
   * one `findManyPublicByRestaurantId` call per restaurant (N+1). Returns
   * only the subset of `restaurantIds` that currently have at least one
   * qualifying Offer; membership in the returned set is the sole meaning.
   */
  findRestaurantIdsWithActivePublicOffer(
    restaurantIds: RestaurantId[],
    now: Date,
  ): Promise<Set<string>>;
}

export const OFFER_REPOSITORY = Symbol('OFFER_REPOSITORY');
