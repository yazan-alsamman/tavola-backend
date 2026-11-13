export interface BranchResult {
  branchId: string;
  restaurantId: string;
  city: string;
  district: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  countryCode: string;
  currency: string | null;
  /** ADR-051: the branch cover file; null means the restaurant cover is shown. */
  coverImageId: string | null;
  referencePrice: number | null;
  priceLevel: number | null;
  timezone: string;
  phone: string | null;
  createdAt: Date;
  updatedAt: Date;
}
