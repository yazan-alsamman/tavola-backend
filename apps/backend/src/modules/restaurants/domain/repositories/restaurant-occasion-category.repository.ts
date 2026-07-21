import { RestaurantOccasionCategory } from '../entities/restaurant-occasion-category.entity';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * No `organizationId` parameter, same reasoning as `WorkingHoursRepository`:
 * `RestaurantOccasionCategory` is NOT in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (it carries no direct `organizationId` column
 * - see the Prisma schema's own comment on this model). Tenant isolation is
 * instead the CALLER's responsibility: every use case must resolve the
 * parent `Restaurant` via the already-tenant-scoped `RestaurantRepository`
 * first, and only call this repository's methods after that succeeds.
 */
export interface RestaurantOccasionCategoryRepository {
  findAllByRestaurantId(restaurantId: RestaurantId): Promise<RestaurantOccasionCategory[]>;
  replaceAllForRestaurant(
    restaurantId: RestaurantId,
    entries: RestaurantOccasionCategory[],
  ): Promise<void>;
}

export const RESTAURANT_OCCASION_CATEGORY_REPOSITORY = Symbol(
  'RESTAURANT_OCCASION_CATEGORY_REPOSITORY',
);
