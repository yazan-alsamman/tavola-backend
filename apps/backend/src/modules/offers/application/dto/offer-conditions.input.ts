/** ADR-047 booking conditions, as Create and Update take them. */
export interface OfferConditionsInput {
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  minPartySize: number | null;
  branchIds: string[];
  oncePerCustomer: boolean;
  bookingCap: number | null;
}
