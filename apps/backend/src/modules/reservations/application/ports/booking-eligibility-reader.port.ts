/**
 * Read-only facts reservation creation needs beyond the reservation
 * aggregate itself. Both reads run without a tenant context (a Customer
 * books across organizations), so they never go through the tenant-scoped
 * Restaurant repository.
 */
export interface BookingEligibilityReaderPort {
  /** True only for an Active, not soft-deleted restaurant. */
  isRestaurantAcceptingReservations(restaurantId: string): Promise<boolean>;

  /** Pending or Approved reservations of this customer that have not ended. */
  countUpcomingActiveForUser(userId: string, now: Date): Promise<number>;

  /**
   * ADR-053: guests of the branch's Pending or Approved reservations that
   * start in `[from, to)`. Backs the daily guest cap.
   */
  sumActiveGuestsForBranchBetween(branchId: string, from: Date, to: Date): Promise<number>;
}

export const BOOKING_ELIGIBILITY_READER = Symbol('BOOKING_ELIGIBILITY_READER');
