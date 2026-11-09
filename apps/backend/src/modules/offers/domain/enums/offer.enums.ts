/**
 * Phase 11 (Offers). Display/filtering discriminator only - no behavioral
 * branching by `type` in the domain layer. ADR-047 adds the four kinds the
 * CR names; the original three stay valid for existing rows and older
 * clients. Recurring days and hours now exist as offer conditions (ADR-047
 * supersedes owner decision D1's "no recurring schedules").
 */
export enum OfferType {
  Promotion = 'Promotion',
  Coupon = 'Coupon',
  Event = 'Event',
  /** A discount on the bill. */
  BillDiscount = 'BillDiscount',
  /** A free item; the value is that item's worth. */
  FreeItem = 'FreeItem',
  /** A set price for a group. */
  GroupPrice = 'GroupPrice',
  /** A discount on the restaurant's quiet days. */
  QuietDays = 'QuietDays',
}

/** The kinds the dashboard offers for a new offer (ADR-047). */
export const CURRENT_OFFER_TYPES: readonly OfferType[] = [
  OfferType.BillDiscount,
  OfferType.FreeItem,
  OfferType.GroupPrice,
  OfferType.QuietDays,
];

/**
 * Coupons are display-only in v1 (owner decision D2) - `discountType`/
 * `discountValue` apply uniformly across every `OfferType`, including
 * `Coupon` and `Event`; there is no redemption engine or reservation/
 * payment integration to enforce a discount against.
 */
export enum OfferDiscountType {
  Percentage = 'Percentage',
  FixedAmount = 'FixedAmount',
}

/**
 * State machine: `(create) -> Draft -> Published -> Expired` (terminal).
 * Draft and Published are editable (ADR-047); every state is
 * soft-deletable by Owner/Admin. `Published -> Expired` is a BullMQ-
 * scheduled, CAS-guarded transition, never reachable through the Update
 * endpoint.
 */
export enum OfferStatus {
  Draft = 'Draft',
  Published = 'Published',
  Expired = 'Expired',
}
