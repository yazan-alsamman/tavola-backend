export interface CustomerInsightsResult {
  uniqueRegisteredCustomers: number;
  returningRegisteredCustomers: number;
  guestBackedReservationCount: number;
  avgPartySize: number | null;
  generatedAt: string;
}
