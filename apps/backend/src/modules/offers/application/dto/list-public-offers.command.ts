export interface ListPublicOffersCommand {
  restaurantId: string;
  page: number;
  limit: number;
  /** Who is looking (client IP); each offer counts one view per viewer per day. */
  viewerKey: string;
}
