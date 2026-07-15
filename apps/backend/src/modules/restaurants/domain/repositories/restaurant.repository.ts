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
}

export const RESTAURANT_REPOSITORY = Symbol('RESTAURANT_REPOSITORY');
