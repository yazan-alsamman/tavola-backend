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
  /** ADR-051: null means the restaurant's value is shown. */
  name: string | null;
  description: string | null;
  coverImageId: string | null;
  referencePrice: number | null;
  priceLevel: number | null;
  timezone: string;
  phone: string | null;
  createdAt: Date;
  updatedAt: Date;
}
