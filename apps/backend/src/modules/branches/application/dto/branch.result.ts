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
  timezone: string;
  phone: string | null;
  createdAt: Date;
  updatedAt: Date;
}
