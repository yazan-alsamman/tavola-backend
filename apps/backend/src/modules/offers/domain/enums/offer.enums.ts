/**
 * Phase 11 (Offers, architecture frozen 2026-07-28, TASKS.md's "Phase 11 —
 * Offers: Pre-implementation architecture decisions"). Display/filtering
 * discriminator only - no behavioral branching by `type` anywhere in the
 * domain layer. Happy Hour / recurring schedules are explicitly out of
 * scope (owner decision D1).
 */
export enum OfferType {
  Promotion = 'Promotion',
  Coupon = 'Coupon',
  Event = 'Event',
}

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
 * Frozen state machine: `(create) -> Draft -> Published -> Expired`
 * (terminal). Draft is the only editable state; every state is
 * soft-deletable by Owner/Admin. `Published -> Expired` is a BullMQ-
 * scheduled, CAS-guarded transition, never reachable through the Update
 * endpoint.
 */
export enum OfferStatus {
  Draft = 'Draft',
  Published = 'Published',
  Expired = 'Expired',
}
