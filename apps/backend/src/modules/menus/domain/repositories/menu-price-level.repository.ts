/**
 * ADR-046: writes every branch's reference price and price level, and each
 * restaurant's `priceLevel` (the rounded average of its branches, kept for
 * app 1.0.2), following `price-level.policy.ts` exactly. Cross-tenant by
 * design: the quartiles rank all branches, so this runs as the System actor.
 */
export interface MenuPriceLevelRepository {
  /** Returns how many branches were written. */
  recomputeAll(): Promise<number>;
}

export const MENU_PRICE_LEVEL_REPOSITORY = Symbol('MENU_PRICE_LEVEL_REPOSITORY');
