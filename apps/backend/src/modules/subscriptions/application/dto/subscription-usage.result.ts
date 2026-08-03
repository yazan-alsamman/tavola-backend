/** ADR-027 §11 - explicit allowlist, never exposes internal implementation detail beyond the counters themselves. */
export interface SubscriptionUsageResult {
  organizationId: string;
  restaurantCount: number;
  maxRestaurants: number;
  restaurants: Array<{
    restaurantId: string;
    branchCount: number;
    maxBranchesPerRestaurant: number;
    employeeCount: number;
    maxEmployeesPerRestaurant: number;
  }>;
}
