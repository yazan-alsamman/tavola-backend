export interface PlatformAdminRestaurantLifecycleCommand {
  restaurantId: string;
  actorId: string;
  correlationId?: string;
}

/**
 * Deliberately distinct from `RestaurantResult` (which excludes
 * `organizationId` - a tenant-scoped caller already knows their own org).
 * ADR-035 §3's DTO requirement is the opposite for Platform Back Office
 * readers: `organizationId` must be INCLUDED, since displaying cross-tenant
 * context to PlatformAdmin is the entire point. `deletedAt` is included so
 * the response of Delete/Restore is self-explanatory.
 */
export interface PlatformAdminRestaurantResult {
  restaurantId: string;
  organizationId: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
