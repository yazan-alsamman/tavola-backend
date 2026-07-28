import { Review } from '../entities/review.entity';
import {
  ReviewId,
  RestaurantId,
  ReservationId,
  UserId,
} from '@shared/domain/value-objects/identifiers.vo';

export interface ReviewListPage {
  items: Review[];
  total: number;
}

/**
 * `Review` carries no `organizationId` column and is not in
 * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (TENANCY.md, Phase 10
 * architecture freeze) - tenant resolution is transitive via
 * `Review.restaurantId -> Restaurant.organizationId`, resolved by the
 * calling use case through the already-tenant-scoped `RestaurantRepository`
 * first, exactly like `AddRestaurantGalleryImageUseCase` does for
 * `RestaurantGalleryImage`. Every `findById`/list method here excludes
 * soft-deleted rows (`deletedAt: null`), matching `Table`/`Restaurant`'s own
 * `findById` precedent - a second delete attempt or a lookup of an
 * already-deleted Review naturally collapses to "not found".
 */
export interface ReviewRepository {
  /** Throws `ReviewAlreadyExistsException` if the database's own
   *  `UNIQUE(reservationId)` constraint rejects a losing concurrent insert
   *  (P2002) - the database-level authority behind the one-review-per-
   *  reservation invariant, never relied on as a pre-check alone. */
  create(review: Review): Promise<void>;

  findById(id: ReviewId): Promise<Review | null>;

  findByReservationId(reservationId: ReservationId): Promise<Review | null>;

  findManyByRestaurantId(
    restaurantId: RestaurantId,
    page: number,
    limit: number,
  ): Promise<ReviewListPage>;

  findManyByUserId(userId: UserId, page: number, limit: number): Promise<ReviewListPage>;

  softDelete(id: ReviewId, at: Date): Promise<void>;
}

export const REVIEW_REPOSITORY = Symbol('REVIEW_REPOSITORY');
