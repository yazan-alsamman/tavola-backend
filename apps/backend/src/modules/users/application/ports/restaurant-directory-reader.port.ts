export interface RestaurantSummary {
  id: string;
  name: string;
  slug: string;
  cuisineType: string | null;
  priceLevel: number | null;
  averageRating: number | null;
  status: string;
}

/**
 * Minimal, read-only cross-tenant lookup of publicly-discoverable Restaurant
 * fields, owned by the Users bounded context (not a full Restaurants
 * repository - Phase 4 is still pending). Required because Favorites is
 * customer-facing: a plain `User` actor carries no `organizationId`
 * (AUTHENTICATION_ARCHITECTURE.md §2.2) and must be able to reference a
 * restaurant belonging to ANY organization, but `Restaurant` is a
 * direct-column tenant-owned model under `withTenantScoping`
 * (tenant-scoped-prisma.extension.ts) - a query through the standard
 * `PrismaContext` client with no bound `organizationId` throws
 * `TenantContextMissingException` by design (TENANCY.md's fail-closed
 * behavior). See `PrismaRestaurantDirectoryReader` for why this is not a
 * `$systemContext` use (TENANCY.md restricts that escape hatch to
 * platform-admin/analytics/support tooling, never a feature module) and
 * instead follows the `PrismaLoginOrganizationReader` precedent exactly.
 *
 * Deliberately excludes `organizationId`/`logoId`/`coverImageId`/
 * `description`/timestamps - only the fields a customer-facing Favorites
 * list needs are exposed (see "Favorites list response" judgment call).
 */
export interface RestaurantDirectoryReaderPort {
  findById(restaurantId: string): Promise<RestaurantSummary | null>;
  findManyByIds(restaurantIds: string[]): Promise<RestaurantSummary[]>;
}

export const RESTAURANT_DIRECTORY_READER = Symbol('RESTAURANT_DIRECTORY_READER');
