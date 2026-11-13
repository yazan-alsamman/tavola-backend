/** ADR-053: what kind of place a branch is. Mirrors the Prisma enum. */
export enum BranchVenueType {
  Restaurant = 'Restaurant',
  Cafe = 'Cafe',
  Patisserie = 'Patisserie',
  Brunch = 'Brunch',
}

/** ADR-053: branch amenities. Mirrors the Prisma enum. */
export enum BranchFeature {
  Shisha = 'Shisha',
  OutdoorSeating = 'OutdoorSeating',
  Heating = 'Heating',
  Parking = 'Parking',
  FamilyFriendly = 'FamilyFriendly',
  PrivateRoom = 'PrivateRoom',
}

/**
 * ADR-053: a branch's plan state, derived from `trialEndsAt` and `pausedAt`.
 * `Paused` wins; `Trial` lasts until `trialEndsAt`; otherwise `Active`.
 */
export enum BranchSubscriptionStatus {
  Trial = 'Trial',
  Active = 'Active',
  Paused = 'Paused',
}
