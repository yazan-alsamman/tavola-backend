export interface PlatformAdminRestaurantLookup {
  readonly restaurantId: string;
  readonly organizationId: string;
}

/**
 * ADR-035 Pattern 2 (Tenant-Agnostic Raw Reader) — resolves which
 * Organization owns a given Restaurant id with no tenant identity bound yet,
 * the precondition every PlatformAdmin Restaurant lifecycle use case needs
 * before it can Explicit-Tenant-Rebind (Pattern 1) to mutate through the
 * ordinary tenant-scoped `RestaurantRepository`. `/platform-admin/restaurants/:id/...`
 * only supplies `restaurantId`, unlike the Organization/Subscription routes
 * where `:id` already IS the organizationId.
 */
export interface PlatformAdminRestaurantLookupReaderPort {
  findOrganizationIdByRestaurantId(
    restaurantId: string,
  ): Promise<PlatformAdminRestaurantLookup | null>;
}

export const PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER = Symbol(
  'PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER',
);
