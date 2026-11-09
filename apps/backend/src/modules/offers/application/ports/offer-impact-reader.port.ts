/**
 * ADR-047: the raw counts behind an offer's impact card. The use case turns
 * them into percentages, the "usual" comparison and the estimated cost.
 */
export interface OfferSlotFilter {
  restaurantId: string;
  /** Empty = every branch. */
  branchIds: string[];
  /** Empty = every day. 0 = Sunday. */
  daysOfWeek: number[];
  /** Branch-local minute of the day, [from, to). Both null = all day. */
  fromMinute: number | null;
  toMinute: number | null;
}

export interface OfferBookingCounts {
  /** Bookings carrying the offer, not rejected/cancelled/expired. */
  bookings: number;
  persons: number;
  /** Of those, completed visits. */
  attended: number;
  /** Bookings whose guest had no earlier booking at this restaurant. */
  newCustomerBookings: number;
}

export interface OfferAttendedValue {
  /** The branch currency, else the restaurant default; null when neither is set. */
  currency: string | null;
  attendedBookings: number;
  /** Σ party size × branch reference price, over visits whose branch has one. */
  personsTimesReferencePrice: number;
  /** Persons of visits whose branch has no reference price yet. */
  unpricedPersons: number;
}

export interface OfferImpactReaderPort {
  countOfferBookings(offerId: string): Promise<OfferBookingCounts>;

  /** All bookings (any source) in the offer's days, hours and branches, between `from` and `to`. */
  countSlotBookings(filter: OfferSlotFilter, from: Date, to: Date): Promise<number>;

  attendedValueByCurrency(offerId: string): Promise<OfferAttendedValue[]>;
}

export const OFFER_IMPACT_READER = Symbol('OFFER_IMPACT_READER');
