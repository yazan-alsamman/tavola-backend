export interface SubscriptionPlanResult {
  planId: string;
  name: string;
  slug: string;
  maxRestaurants: number;
  maxBranchesPerRestaurant: number;
  maxEmployeesPerRestaurant: number;
  archivedAt: Date | null;
}
