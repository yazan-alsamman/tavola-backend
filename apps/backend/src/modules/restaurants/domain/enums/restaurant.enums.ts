/**
 * Only the two states EVENTS.md documents lifecycle events for
 * (`RestaurantActivated`/`RestaurantSuspended`). Soft delete is a separate
 * concern (`Restaurant.deletedAt`), not a third status value.
 */
export enum RestaurantStatus {
  Active = 'Active',
  Suspended = 'Suspended',
}
