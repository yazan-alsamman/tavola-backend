/**
 * ADR-046 (CR WJ-R-2026-002, menu page): a branch's price level is computed
 * from its menu, never chosen by the restaurant.
 *
 * 1. Rank the branch's menu items by price, highest first.
 * 2. Skip the most expensive one (a sharing platter must not lift the level).
 * 3. The reference price is the average of the next ten (ranks 2 to 11).
 * 4. Rank every branch with the same currency by reference price, restaurants
 *    and cafes together; the level is the quartile the branch falls in (1-4).
 */
export const PRICE_LEVEL_SKIPPED_TOP_ITEMS = 1;
export const PRICE_LEVEL_REFERENCE_ITEMS = 10;
export const PRICE_LEVEL_COUNT = 4;

/** The reference price of one menu, or null when it has fewer than two priced items. */
export function referencePriceOf(prices: number[]): number | null {
  const ranked = prices
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => b - a)
    .slice(
      PRICE_LEVEL_SKIPPED_TOP_ITEMS,
      PRICE_LEVEL_SKIPPED_TOP_ITEMS + PRICE_LEVEL_REFERENCE_ITEMS,
    );
  if (ranked.length === 0) {
    return null;
  }
  const average = ranked.reduce((sum, price) => sum + price, 0) / ranked.length;
  return Math.round(average * 100) / 100;
}

/**
 * The level for a branch whose reference price has cumulative distribution
 * `cumeDist` (share of same-currency branches priced at or below it, 0-1].
 */
export function priceLevelOf(cumeDist: number): number {
  const level = Math.ceil(cumeDist * PRICE_LEVEL_COUNT);
  return Math.min(PRICE_LEVEL_COUNT, Math.max(1, level));
}
