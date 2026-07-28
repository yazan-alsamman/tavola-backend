import { Restaurant } from '../entities/restaurant.entity';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { RestaurantSlug } from '@shared/domain/value-objects/restaurant-slug.vo';

export interface RestaurantListPage {
  items: Restaurant[];
  total: number;
}

/**
 * No `organizationId` parameter on any method: `Restaurant` is registered in
 * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (TENANCY.md), so the
 * injected `PrismaContext` client scopes every query/write to the caller's
 * bound tenant automatically - passing it here again would be redundant and
 * could misleadingly suggest the caller controls tenant scope, when the
 * Prisma extension always overrides it regardless.
 */
export interface RestaurantRepository {
  findById(id: RestaurantId): Promise<Restaurant | null>;
  existsBySlug(slug: RestaurantSlug): Promise<boolean>;
  findMany(page: number, limit: number): Promise<RestaurantListPage>;
  save(restaurant: Restaurant): Promise<void>;

  /**
   * Phase 10 (Reviews, architecture frozen 2026-07-26). A narrow,
   * boolean-only existence check safe to call from a fully public,
   * unauthenticated route (`GET /restaurants/:id/reviews`) - unlike every
   * other method here, this one is NOT scoped by `withTenantScoping`'s
   * Prisma Client Extension (it uses raw SQL, which extensions cannot
   * intercept, exactly like `recomputeAverageRating`'s own precedent),
   * because a public route has no bound `TenantContext.organizationId` at
   * all and the ordinary `findById` above would throw
   * `TenantContextMissingException` (fail-closed, correctly, for every
   * OTHER caller). Safe specifically because this returns only a boolean,
   * never the Restaurant's own fields (name, organizationId, etc.), and
   * because a Restaurant whose Reviews are themselves public data (owner
   * decision #13) has no confidentiality interest in its mere existence
   * being checkable. Never use this for anything other than an existence
   * gate on an intentionally-public route.
   */
  existsPubliclyById(id: RestaurantId): Promise<boolean>;

  /**
   * Phase 10 (Reviews, architecture frozen 2026-07-26, owner decision #17):
   * recomputes `averageRating` as `AVG(rating)` over this restaurant's
   * active (`deletedAt IS NULL`) Reviews, as a single atomic `UPDATE`
   * statement. Must be called inside the same `UnitOfWorkPort.execute`
   * transaction as the triggering Review create/delete, and **only after**
   * that transaction has already called `lockForRatingRecompute` below for
   * the same `restaurantId` - see that method's doc comment for why a bare
   * `UPDATE ... SET x = (SELECT ...)` is not, by itself, safe under
   * concurrent writers. Deliberately a narrow, single-column write (never
   * the generic `save()` full-row upsert) so a concurrent, unrelated
   * Restaurant profile edit can never be clobbered by a stale in-memory
   * entity - mirrors `markLateArrivalNotifiedIfEligible`'s own "no
   * in-memory entity round-trip needed" precedent. Sets `averageRating` to
   * `null` when the restaurant has zero active reviews - never `0`.
   */
  recomputeAverageRating(restaurantId: RestaurantId, at: Date): Promise<void>;

  /**
   * Phase 10 bug fix (found during live concurrency verification, see
   * TASKS.md's Phase 10 report): acquires `SELECT ... FOR UPDATE` on the
   * `restaurants` row *before* the transaction inserts/soft-deletes the
   * Review row that triggers a `recomputeAverageRating` call. A bare
   * `UPDATE restaurants SET average_rating = (SELECT AVG(...) FROM
   * reviews ...)` is not safe under concurrent writers: Postgres plans the
   * uncorrelated `AVG` subquery as an InitPlan, evaluated once against the
   * statement's starting snapshot - a transaction that blocks on the target
   * row's write lock and then proceeds once unblocked does NOT get a fresh
   * subquery re-evaluation, so it can silently overwrite the correct
   * average with a stale one computed before sibling transactions
   * committed (reproduced directly against Postgres: 5/8 trials wrong with
   * no lock, 0/15 wrong with this lock acquired first). Must be called
   * BEFORE the review mutation, never after - the review INSERT's own FK
   * check takes a `FOR KEY SHARE` lock on this same row, and acquiring
   * `FOR UPDATE` afterward deadlocks against a concurrent transaction doing
   * the same thing in the same order (reproduced: two transactions each
   * holding the other's needed lock upgrade).
   */
  lockForRatingRecompute(restaurantId: RestaurantId): Promise<void>;
}

export const RESTAURANT_REPOSITORY = Symbol('RESTAURANT_REPOSITORY');
