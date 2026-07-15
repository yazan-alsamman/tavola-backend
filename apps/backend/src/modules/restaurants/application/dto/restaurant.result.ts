/**
 * Explicit field allowlist. `organizationId` is deliberately excluded - the
 * caller already knows their own organization from the JWT, and echoing it
 * back adds nothing (unlike `userId` on `UserProfileResult`, which a client
 * genuinely needs to correlate its own identity).
 */
export interface RestaurantResult {
  restaurantId: string;
  name: string;
  slug: string;
  logoId: string | null;
  coverImageId: string | null;
  description: string | null;
  cuisineType: string | null;
  averageRating: number | null;
  priceLevel: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}
