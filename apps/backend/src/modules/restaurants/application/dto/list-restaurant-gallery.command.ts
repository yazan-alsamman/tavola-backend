export interface ListRestaurantGalleryCommand {
  restaurantId: string;
  /** ADR-051: the branch whose photos these are; omitted, the restaurant's oldest branch. */
  branchId?: string;
}
